# Architecture & Engineering Log

**Project:** BLD Remote Browser Control System  
**Status:** Implemented locally — Docker + Node.js + Next.js  
**How to read this:** The codebase in `remote-browser/` was **built from scratch**. Before implementation, two production open-source projects were **audited** (read, not forked, not vendored) to understand how real systems handle session lifecycle and screen streaming. This document records what we learned, what we adopted, what we rejected, and every significant problem encountered during build.

---

## 1. Open Source Audit (Design Phase)

These repos were studied during architecture design. They are **not dependencies** and are **not included** in this repository.

### [browserless/browserless](https://github.com/browserless/browserless)

Production browser-as-a-service. Manages headless Chromium in Docker with REST/WebSocket APIs.

| Studied | Adopted into our system | Rejected (and why) |
|---|---|---|
| `BrowserManager` session map with typed session objects | `SessionManager` with single active session + sync eviction before `container.stop()` | Multi-browser abstraction (Playwright/Firefox/WebKit) — assignment is Chromium-only |
| `AutoRemove: true` on containers | Yes — container self-deletes even if backend crashes | Full REST surface (PDF, scrape, Lighthouse) — out of scope |
| Refcount / disconnect-driven cleanup | WS disconnect → `killSession()` + bridge teardown | Concurrency queue and worker pool — single local user |
| CDP readiness polling strategy | `waitForReady()` utility with configurable retries | Their hosted deployment model — we run everything locally |

**Skill demonstrated:** Understood a production session lifecycle model, extracted the *minimum* pattern needed for a single-user local tool, and implemented it with TDD.

---

### [strange-v/RemoteWebViewServer](https://github.com/strange-v/RemoteWebViewServer)

Streams headless Chromium to lightweight clients (e.g. ESP32 displays) over WebSocket.

| Studied | Adopted into our system | Rejected (and why) |
|---|---|---|
| Frame hash dedup before broadcast | `hash32()` + `FrameProcessor.shouldSend()` | Tile-based diff protocol (32×32px tiles) — overkill for localhost single client |
| Idle guard when no WS clients connected | Skip broadcast when `clientCount === 0` | ESP32-specific client protocol — we use a browser canvas |
| `Page.startScreencast` push model + immediate ACK | `BrowserBridge` CDP screencast with `screencastFrameAck` | Screenshot polling loop — higher CPU, no backpressure |
| socat proxy for CDP inside Docker | `docker/start.sh` — Chromium on `127.0.0.1:9223`, socat on `0.0.0.0:9222` | Their full device-manager architecture — we needed only the networking fix |
| `perMessageDeflate: false` on WebSocket | Applied in `WSRelay` | — |

**Skill demonstrated:** Evaluated a streaming system built for embedded hardware, identified which optimizations transfer to a desktop web UI, and rejected complexity that didn't match our constraints.

---

## 2. System Architecture

```
┌─────────────────────┐    POST /session/start     ┌──────────────────────┐
│  Next.js Frontend   │ ──────────────────────────► │  Node.js Backend     │
│  (localhost:3000)   │                             │  (localhost:3001)    │
│                     │    WebSocket /ws            │                      │
│  <canvas> ◄────────┤ ◄──── binary JPEG frames ── │  WSRelay             │
│                     │                             │  BrowserBridge       │
│  click/scroll/kbd ──┤ ───── JSON input events ──► │  SessionManager      │
└─────────────────────┘                             └──────────┬───────────┘
                                                               │ dockerode
                                                               ▼
                                                    ┌──────────────────────┐
                                                    │  Docker: bld-chromium │
                                                    │  Chromium (headless)  │
                                                    │  socat :9222 → :9223  │
                                                    │  CDP (Puppeteer)      │
                                                    └──────────────────────┘
```

### Data flows

**Frame path (server → client)**  
Chromium renders page → CDP `Page.screencastFrame` event → base64 decode → `FrameProcessor` (dedup + idle guard) → throttle (~30fps) → `WSRelay.broadcastFrame()` → WebSocket binary → frontend `Blob` → `canvas.drawImage()`

**Input path (client → server)**  
Canvas mouse/keyboard → `scaleCoordinates()` (CSS px → 1280×720 viewport) → `sendInput()` JSON over WS → `WSRelay.emit('message')` → `handleInput()` → Puppeteer `page.mouse` / `page.keyboard` / `page.goto`

**Session path**  
`POST /session/start` → `SessionManager.startSession()` → Docker create + start → poll CDP `/json/version` → `BrowserBridge.connect()` → `session_ready` over WS  
`DELETE /session/stop` or WS disconnect → `bridge.disconnect()` → `killSession()` → container stopped (AutoRemove deletes it)

### Component responsibilities

| Component | Owns | Key decision |
|---|---|---|
| `SessionManager` | Docker container lifecycle | Single session, `HostPort: '0'` for dynamic CDP port |
| `BrowserBridge` | Puppeteer + CDP screencast | Push model, not screenshot polling |
| `FrameProcessor` | Dedup + idle guard | Separated for unit testing |
| `WSRelay` | WebSocket clients + broadcast | `perMessageDeflate: false` for latency |
| `input-handler` | WS JSON → Puppeteer actions | Pure function, easy to test |
| `useRemoteBrowser` | Frontend WS lifecycle | Status machine: idle → connecting → streaming |
| `page.tsx` | Canvas render + input capture | Coordinate scaling to fixed viewport |

---

## 3. Trade-off Register

Decisions made explicitly — not accidental.

| Decision | Chosen | Alternative considered | Why |
|---|---|---|---|
| Streaming | CDP `Page.startScreencast` (push) | `page.screenshot()` polling (pull) | Push has backpressure via ACK; polling melts CPU |
| Frame dedup | Sampled FNV hash (`hash32`) | Full MD5 / pixel diff | Fast enough, testable, good enough for static-page skip |
| Frame rate | ~30fps (`minFrameIntervalMs: 33`) | 10fps (initial) / 60fps | 30fps feels live on localhost without saturating CPU |
| JPEG quality | 75 | 60 (initial) / 90 | Better visuals; localhost bandwidth is not a constraint |
| Container image | Custom `bld-chromium` Dockerfile | `ghcr.io/browserless/chromium` directly | Full control over flags, socat entrypoint, and image size |
| CDP networking | socat proxy inside container | Publish Chromium port directly | Required fix for Docker Desktop NAT on Windows/Mac |
| Dev watcher | `node --watch` (single process) | `tsx watch` (parent + child) | Child processes orphaned on Windows terminal close → `EADDRINUSE` |
| Session model | One active session | Multi-session map | Assignment scope: single viewer, single container |
| Frontend framework | Next.js App Router | Vite + React | Assignment lists React/Next.js; App Router is current default |
| Testing | Vitest + TDD per module | Manual-only | Catches regressions in session lifecycle, dedup, WS relay |
| Logging | pino structured logs | `console.log` | Debuggable Docker/CDP timing issues; `LOG_LEVEL` for prod silence |

---

## 4. Problems Faced (Implementation Log)

A running record of blockers and how they were resolved.

### 4.1 Docker Desktop rejects CDP connections from host

**Symptom:** `SessionManager` creates container, port is mapped, but `fetch` to CDP endpoint fails with "other side closed".

**Root cause:** Chromium's DevTools HTTP server binds to `127.0.0.1` and rejects connections that don't appear to come from loopback. On Docker Desktop (Windows/Mac), the host reaches the container through a NAT gateway IP — Chromium sees a non-localhost peer and closes the connection.

**Fix:** Inside the container, run Chromium on `127.0.0.1:9223` and front it with `socat TCP-LISTEN:9222 → TCP:127.0.0.1:9223`. Published port 9222 accepts external connections; socat forwards them to Chromium as localhost.

**Files:** `docker/start.sh`, `docker/Dockerfile`

**Pattern source:** RemoteWebViewServer docker-compose (studied during OSS audit)

---

### 4.2 Frontend stuck on "connecting" after Start Session

**Symptom:** Backend logs show session started; UI never reaches "streaming".

**Root cause:** Race condition. Backend sent `session_ready` immediately after `POST /session/start` returned, but the frontend opened its WebSocket *after* the POST completed — missing the first message.

**Fix (two-sided):**
1. Frontend: set status to `streaming` on `ws.onopen` (session is ready if POST succeeded)
2. Backend: on new WS connect, re-send `session_ready` if a session is already active

**Files:** `frontend/hooks/useRemoteBrowser.ts`, `backend/src/index.ts`

---

### 4.3 `EADDRINUSE` on port 3001 during `npm run dev`

**Symptom:** Backend fails to start; port 3001 already in use.

**Root cause:** `tsx watch` spawns a child Node process. On Windows, closing the terminal sometimes kills the parent but leaves the child listening on 3001.

**Fix:**
1. Switched dev script to `node --watch --import tsx/esm` (single process)
2. Added graceful shutdown handlers (`SIGINT` / `SIGTERM`) to stop Docker session and close server
3. Added auto-recovery: on `EADDRINUSE`, kill port occupant and retry listen

**Files:** `backend/package.json`, `backend/src/index.ts`

---

### 4.4 URL bar disabled before session — couldn't set starting URL

**Symptom:** Default `https://google.com` loaded; user couldn't change URL until after streaming started.

**Root cause:** URL input was `disabled={!isStreaming}` — intentional guard (no browser to navigate yet) but poor UX.

**Fix:** Allow typing anytime; auto-navigate to URL bar value when status transitions to `streaming`.

**Files:** `frontend/app/page.tsx`

---

### 4.5 Frame hash collision in unit tests

**Symptom:** `FrameProcessor` test expected different frames to produce different hashes; assertion failed.

**Root cause:** `hash32` samples every 16th byte. Test buffers were identical at sampled positions.

**Fix:** Adjusted test data so sampled bytes differ (`0xaa` vs `0xbb`).

**Files:** `backend/tests/unit/frame-processor.test.ts`

---

### 4.6 SessionManager mock instability in tests

**Symptom:** `vi.mock('dockerode')` + `vi.resetModules()` caused `createContainer is not a function`.

**Root cause:** Vitest mock hoisting with constructor-internal `new Dockerode()`.

**Fix:** Dependency injection — pass mock `dockerode` instance into `SessionManager` constructor.

**Files:** `backend/src/session-manager.ts`, `backend/tests/unit/session-manager.test.ts`

---

## 5. What Was Built From Scratch

Everything under `remote-browser/` is original implementation:

- Express REST API (`/health`, `/session`, `/session/start`, `/session/stop`)
- WebSocket relay with binary frame broadcast + JSON input routing
- Docker session lifecycle via dockerode
- Custom Chromium Docker image with socat entrypoint
- Puppeteer CDP screencast bridge with dedup and throttle
- Next.js UI with canvas streaming, coordinate scaling, URL bar
- **50 automated tests** (unit + integration with real Docker)
- Structured logging with pino

Open source informed **decisions**, not **code copy-paste**. The architecture doc above is the audit trail.

---

## 6. Verification Checklist

| Check | How |
|---|---|
| Session starts container | `docker ps` shows `bld-chromium` after Start Session |
| Session stops container | `docker ps` empty after Stop / tab close |
| Container fully removed | `docker ps -a` — no exited `bld-chromium` (AutoRemove) |
| Frames streaming | UI shows frame counter incrementing |
| Input works | Click/type in canvas affects remote page |
| Backend health | `GET http://localhost:3001/health` → 200 |

---

## 7. Submission Narrative (for Google Form)

> I built a remote browser control system from scratch using Docker, Node.js, and Next.js. Before coding, I audited browserless and RemoteWebViewServer to understand production patterns for session lifecycle and frame streaming — then deliberately adopted only what fit a single-user local tool (sync session eviction, screencast push model, frame dedup, socat CDP proxy) and rejected what didn't (tile diff protocol, multi-browser abstraction, hosted API surface). The hardest bug was Docker Desktop's CDP localhost rejection on Windows, solved with an in-container socat proxy. I used TDD throughout (50 tests) and kept a structured engineering log of trade-offs and blockers.

---

*Last updated: June 2026*
