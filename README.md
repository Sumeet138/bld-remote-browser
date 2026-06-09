# Remote Browser — BLD Assignment

A mini-TeamViewer for the browser: spins up a Dockerized Chromium instance on demand, streams its screen to a React UI in real-time, and forwards keyboard/mouse input back to the browser.

**Built from scratch** for the BLD assignment. Architecture was informed by an open-source audit of [browserless](https://github.com/browserless/browserless) and [RemoteWebViewServer](https://github.com/strange-v/RemoteWebViewServer) — patterns were studied, selectively adopted, and complexity was deliberately rejected. See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for the full architecture, trade-off register, and implementation problem log.

---

## Architecture

```
┌─────────────────────┐    POST /session/start     ┌──────────────────────┐
│  Next.js Frontend   │ ──────────────────────────► │  Node.js Backend     │
│  (localhost:3000)   │                             │  (localhost:3001)    │
│                     │    WebSocket /ws            │                      │
│  canvas ◄───────────┤ ◄────────────────────────── │  WSRelay             │
│  (JPEG frames)      │                             │  BrowserBridge       │
│                     │    JSON input events        │  SessionManager      │
│  click/kbd/scroll ──┤ ──────────────────────────► │                      │
└─────────────────────┘                             └──────────┬───────────┘
                                                               │ dockerode
                                                               ▼
                                                    ┌──────────────────────┐
                                                    │  Docker Container    │
                                                    │  bld-chromium        │
                                                    │  Chromium + socat    │
                                                    │  (CDP port 9222)     │
                                                    └──────────────────────┘
```

**Frame flow:** Chromium → CDP screencast → BrowserBridge (dedup + throttle) → WSRelay.broadcastFrame → WebSocket → canvas.drawImage

**Input flow:** canvas mouse/kbd events → sendInput → WebSocket → WSRelay.emit('message') → handleInput → Puppeteer page.mouse/keyboard

---

## Quick Start

### Prerequisites

- Docker Desktop (running)
- Node.js 20+

### 1. Build the Chromium image

```bash
docker build -t bld-chromium ./docker
```

This only needs to be done once. The image is ~800MB (Chromium + socat).

### 2. Start the backend

```bash
cd backend
npm install
npm run dev
```

Backend listens on `http://localhost:3001`.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend available at `http://localhost:3000`.

### 4. Use it

Open `http://localhost:3000` → click **Start Session** → wait ~1s for Chromium to boot → see the live browser stream → click/type/scroll as normal.

---

## Environment Variables

### Backend

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `LOG_LEVEL` | `info` | Logging verbosity (`trace` / `debug` / `info` / `warn` / `error` / `silent`) |
| `LOG_PRETTY` | `true` | Human-readable pino-pretty output (set `false` for JSON in production) |

### Frontend

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:3001` | Backend API base URL |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` | WebSocket endpoint |

---

## Running Tests

### Unit tests (no Docker required)

```bash
cd backend
npm run test:unit
```

### Integration tests (requires Docker Desktop + bld-chromium image)

```bash
cd backend
npm run test:integration
```

### Frontend tests

```bash
cd frontend
npm test
```

---

## Project Structure

```
remote-browser/
├── docker/
│   ├── Dockerfile       # debian:bookworm-slim + Chromium + socat proxy
│   └── start.sh         # startup script: Chromium on :9223, socat on :9222
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express + WS server entry point
│   │   ├── config.ts             # Typed env config
│   │   ├── logger.ts             # pino root + createLogger(module)
│   │   ├── session-manager.ts    # Docker lifecycle (start/kill)
│   │   ├── browser-bridge.ts     # Puppeteer + CDP screencast
│   │   ├── ws-relay.ts           # WebSocket server + broadcast
│   │   ├── frame-processor.ts    # Dedup + idle guard
│   │   ├── input-handler.ts      # WS messages → Puppeteer page
│   │   └── util/
│   │       ├── hash32.ts         # FNV sampled hash for frame dedup
│   │       └── waitForReady.ts   # CDP readiness poll
│   └── tests/
│       ├── unit/                 # Fast, no Docker
│       └── integration/          # Real Docker + Puppeteer
├── frontend/
│   ├── app/page.tsx              # Canvas + controls
│   ├── hooks/useRemoteBrowser.ts # WS lifecycle hook
│   └── utils/coords.ts           # Canvas → viewport coordinate scaling
├── docs/
│   └── ARCHITECTURE.md  # OSS audit, trade-offs, problem log
└── README.md
```

---

## Design Decisions

Key decisions are documented in **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** including:

- CDP screencast (push) vs screenshot polling (pull)
- socat proxy for Docker Desktop CDP networking on Windows/Mac
- Frame dedup + idle guard (from streaming OSS audit)
- Sync session eviction before async `container.stop()`
- Trade-offs explicitly rejected (tile diff, multi-browser abstraction)

**Quick summary — socat:** Chromium only accepts CDP from `127.0.0.1`. Docker Desktop NAT makes host connections look external. socat inside the container proxies `0.0.0.0:9222 → 127.0.0.1:9223` so Puppeteer can connect from the host.

---

## Test Coverage Summary

| Suite | Tests | Notes |
|---|---|---|
| `hash32` | 5 | Pure fn, deterministic |
| `logger` | 3 | pino child bindings |
| `waitForReady` | 4 | Retry logic with mock fetch |
| `FrameProcessor` | 6 | Dedup + idle guard |
| `SessionManager` | 8 | dockerode DI mocked |
| `WSRelay` | 5 | Real WebSocketServer on random port |
| `inputHandler` | 6 | Puppeteer page mock |
| `session routes` | 5 | supertest + spyOn |
| `health` | 2 | supertest |
| `session lifecycle` | 3 | **Real Docker** |
| `streaming pipeline` | 3 | **Real Docker + real JPEG frames** |
| **Total** | **50** | |
