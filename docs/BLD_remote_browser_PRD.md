# PRD — Remote Browser Control System
### BLD SDE Intern Assignment · Author: [Your Name] · Status: Draft

---

## 0. One-line context

> Build a local mini-TeamViewer for a browser: spin up a Dockerised Chromium on demand, stream its screen to a React UI in real time, and forward user input back into it.

---

## 1. Problem Statement

Headless browsers are normally invisible — you fire commands at them and get results back. This system flips that: the headless browser's screen becomes visible in a web UI, and the user's mouse and keyboard events are forwarded into it. The result is a remotely-controlled browser, running entirely locally inside Docker, with no deployment required.

This pattern is the foundation of browser automation platforms (browserless.io), cloud dev environments (CodeSandbox, Gitpod), and remote desktop tools (TeamViewer, Guacamole).

---

## 2. Goals & Non-Goals

### Goals
- One-click "Start Browser" button that spins up a Docker container with headless Chromium
- Live screen stream from Chromium back to the web UI (target: <150ms latency)
- Full input forwarding: mouse click, scroll, keyboard typing
- Clean session lifecycle: container starts on demand, auto-kills on disconnect
- Everything runs locally — no cloud, no deployment

### Non-goals
- Multi-user sessions (single viewer per container)
- Authentication / access control
- Multiple browser types (Firefox, WebKit) — Chromium only
- Persistent sessions across page reloads
- Mobile touch input support

---

## 3. The Story (why this is hard)

You open a webpage. You click "Start Browser." Behind the scenes:

1. Your frontend fires a WebSocket message to a Node.js backend.
2. The backend calls the Docker SDK to spin up a container with Chromium running in headless mode with the remote debugging port open.
3. The backend connects to that port using Chrome DevTools Protocol (CDP) via Puppeteer.
4. Puppeteer starts taking screenshots of the page at ~10fps, encodes them as JPEG, and pushes them over WebSocket to your frontend.
5. Your frontend renders each frame on a `<canvas>` element.
6. When you click on the canvas, the frontend converts canvas coordinates to browser coordinates and sends a `{type: 'click', x, y}` message over WebSocket.
7. The backend receives it and calls `page.mouse.click(x, y)` via Puppeteer.
8. The browser responds. The next screenshot captures the result.
9. When you close the tab, the WebSocket disconnects. The backend detects this and kills the Docker container.

The hard parts: Docker networking (binding the debug port), CDP handshake timing (Chromium needs ~1s to be ready after container starts), screenshot loop management (don't keep screenshotting if nobody is watching), and WebSocket frame budgeting (don't send identical frames).

---

## 4. Open Source Reference Architecture

> **Note:** These repos were **audited during the design phase** — read and studied, not forked or vendored into this repository. The implemented system lives entirely in `remote-browser/`. Full audit trail, trade-offs, and problem log: [`remote-browser/docs/ARCHITECTURE.md`](../remote-browser/docs/ARCHITECTURE.md).

Two repos studied. Patterns borrowed consciously, complexity rejected consciously.

### 4.1 browserless/browserless — studied for session lifecycle

**What it does:** Manages headless browsers as a service in Docker, with REST + WebSocket APIs for Puppeteer/Playwright clients.

**Pattern borrowed:** `BrowserManager` — a `Map<BrowserInstance, SessionObject>` that tracks every live browser against a typed session (startedOn, numbConnected, resolver, userDataDir). On disconnect, decrement `numbConnected`; destroy when it hits zero.

**Pattern rejected:** Multi-browser abstraction (Playwright/Firefox/WebKit), REST API surface (PDF, scrape, Lighthouse), concurrency queue — all overkill for a single-session local tool.

### 4.2 strange-v/RemoteWebViewServer — studied for streaming efficiency

**What it does:** Streams a headless Chromium screen as JPEG tiles over WebSocket to lightweight clients (ESP32 displays).

**Pattern borrowed:** Frame hash-dedup — before sending a frame, compute its MD5. If it matches the previous frame's hash, skip it. Zero bytes sent when page is idle. One line of code, massive practical impact.

**Pattern borrowed:** Idle guard — when no WebSocket client is connected, stop the screenshot loop entirely. Resume on reconnect.

**Pattern rejected:** Tile-based diff protocol — splits the screen into 32×32px tiles and only sends changed tiles. Brilliant for embedded clients, overkill for a browser tab over localhost.

---

## 5. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js (React) | Assignment requirement; canvas rendering, WS client |
| Backend | Node.js (Express + ws) | Assignment requirement; Docker SDK available |
| Browser control | Puppeteer (puppeteer-core) | CDP abstraction; `page.screenshot()`, `page.mouse`, `page.keyboard` |
| Container runtime | Docker (dockerode SDK) | Programmatic container lifecycle, no shell exec hacks |
| Browser image | `ghcr.io/browserless/chromium` or custom `Dockerfile` | Pre-tuned Chromium flags for headless; avoids missing font/lib issues |
| Transport | WebSocket (ws library) | Bidirectional; low overhead for frame streaming |
| Frame encoding | JPEG via Puppeteer's `page.screenshot({ type: 'jpeg', quality: 60 })` | Good compression, fast encode, acceptable quality |

---

## 6. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (user)                      │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │              Next.js Web UI                       │  │
│   │                                                   │  │
│   │  [Start Browser]     <canvas id="viewport"/>     │  │
│   │                                                   │  │
│   │  • renders JPEG frames on canvas                 │  │
│   │  • captures mouse/keyboard events                │  │
│   │  • sends input as JSON over WebSocket            │  │
│   └──────────────┬───────────────────────────────────┘  │
└──────────────────│──────────────────────────────────────┘
                   │  WebSocket  ws://localhost:3001
                   │  (frames down, input events up)
┌──────────────────▼──────────────────────────────────────┐
│                   Node.js Backend                         │
│                                                          │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  SessionManager  │  │ BrowserBridge│  │ WSRelay   │  │
│  │                  │  │              │  │           │  │
│  │  • dockerode SDK │  │  • Puppeteer │  │ • ws lib  │  │
│  │  • Map<id,sess>  │  │  • CDP conn  │  │ • binary  │  │
│  │  • auto-cleanup  │  │  • screenshot│  │   frames  │  │
│  │                  │  │    loop      │  │           │  │
│  └────────┬─────────┘  └──────┬───────┘  └─────┬─────┘  │
└───────────│────────────────────│────────────────│────────┘
            │  Docker SDK        │  CDP / WS      │
            │                    │  port 9222     │
┌───────────▼────────────────────▼────────────────┘
│              Docker Container
│
│   ┌──────────────────────────────────┐
│   │  Chromium (headless)             │
│   │                                  │
│   │  --remote-debugging-port=9222    │
│   │  --no-sandbox                    │
│   │  --disable-dev-shm-usage         │
│   │  --window-size=1280,720          │
│   └──────────────────────────────────┘
└──────────────────────────────────────
```

### Module responsibilities

**SessionManager** — owns Docker. Calls `dockerode.createContainer()`, tracks the container ID, exposes `startSession()` and `killSession()`. Listens for WebSocket disconnect to trigger cleanup. Inspired by browserless `BrowserManager`.

**BrowserBridge** — owns Puppeteer. After the container is up (with a poll-wait for CDP port readiness), connects via `puppeteer.connect({ browserWSEndpoint })`. Runs the screenshot loop: capture → hash → compare → send if changed. Handles `mouse.click`, `mouse.move`, `mouse.wheel`, `keyboard.type`. Implements idle guard from RemoteWebViewServer.

**WSRelay** — owns the WebSocket server. Upgrades HTTP connections, routes incoming messages (`{type: 'start'}`, `{type: 'click', x, y}`, `{type: 'scroll', dx, dy}`, `{type: 'type', key}`) to the BrowserBridge. Pushes binary JPEG frames to connected clients.

---

## 7. API & Message Protocol

### 7.1 HTTP REST endpoints (Express)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Server liveness check — returns `{ status: 'ok' }` |
| `GET` | `/session` | Returns current session state: `{ active: bool, containerId, startedAt }` |
| `POST` | `/session/start` | Triggers `SessionManager.startSession()` — spins up container |
| `DELETE` | `/session/stop` | Force-kills active container and resets state |

### 7.2 WebSocket messages — Client → Server

All messages are JSON strings.

```jsonc
// Start a browser session
{ "type": "start" }

// Mouse click at canvas coordinates
{ "type": "click", "x": 340, "y": 200, "button": "left" }

// Mouse move (throttled to 1 event per 16ms on client)
{ "type": "mousemove", "x": 340, "y": 200 }

// Scroll wheel
{ "type": "scroll", "x": 340, "y": 200, "deltaY": -120 }

// Keyboard input
{ "type": "keydown", "key": "Enter" }
{ "type": "type", "text": "hello world" }
```

### 7.3 WebSocket messages — Server → Client

Frames are sent as binary (ArrayBuffer / Buffer). Everything else is JSON.

```jsonc
// Session started — client can now expect frames
{ "type": "session_ready", "sessionId": "abc123" }

// Error from backend
{ "type": "error", "message": "Container failed to start" }

// Session ended (e.g. timeout or explicit kill)
{ "type": "session_ended" }
```

Frames: raw binary JPEG buffer. Client detects binary vs string using `typeof event.data === 'string'` check.

### 7.4 Coordinate system

Canvas pixels map 1:1 to browser pixels. The Chromium window is launched at `1280×720`. The canvas is rendered at `1280×720` (CSS-scaled to fit viewport). Input events from canvas are passed through as-is to Puppeteer.

---

## 8. Data Flow — Screenshot Loop

```
BrowserBridge.startLoop()
  │
  ├─ every 100ms:
  │     screenshot = await page.screenshot({ type: 'jpeg', quality: 60 })
  │     hash       = md5(screenshot)
  │     if hash === lastHash → skip (borrowed from RemoteWebViewServer)
  │     lastHash   = hash
  │     WSRelay.broadcast(screenshot)   ← binary frame
  │
  └─ loop stops when:
        • no WS clients connected (idle guard)
        • SessionManager.killSession() called
        • Puppeteer disconnects unexpectedly
```

---

## 9. Container Lifecycle

```
POST /session/start
  │
  ├─ SessionManager.startSession()
  │     dockerode.createContainer({
  │       Image: 'chromium-remote',
  │       Cmd: ['chromium', '--headless', '--remote-debugging-port=9222',
  │              '--no-sandbox', '--disable-dev-shm-usage',
  │              '--window-size=1280,720'],
  │       PortBindings: { '9222/tcp': [{ HostPort: '9222' }] },
  │       AutoRemove: true   ← container self-deletes on stop
  │     })
  │     container.start()
  │
  ├─ BrowserBridge.waitForReady()   ← polls GET http://localhost:9222/json/version
  │     retry every 200ms, max 10 attempts
  │     throws if Chromium never responds
  │
  ├─ BrowserBridge.connect()
  │     puppeteer.connect({ browserWSEndpoint: ws://localhost:9222/... })
  │     page = await browser.newPage()
  │     page.setViewport({ width: 1280, height: 720 })
  │
  └─ BrowserBridge.startLoop()   ← begins screenshot loop

WS disconnect detected by WSRelay
  │
  └─ SessionManager.killSession()
        container.stop()        ← Docker SIGTERM → container auto-removes
        BrowserBridge.stopLoop()
        session = null
```

---

## 10. Dockerfile (custom image)

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Expose CDP port
EXPOSE 9222

CMD ["chromium", \
     "--headless", \
     "--remote-debugging-port=9222", \
     "--remote-debugging-address=0.0.0.0", \
     "--no-sandbox", \
     "--disable-dev-shm-usage", \
     "--disable-gpu", \
     "--window-size=1280,720", \
     "--user-data-dir=/tmp/chromium-data"]
```

---

## 11. Frontend — Key Implementation Notes

### Canvas rendering

```jsx
// Render incoming binary JPEG frames on canvas
ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    handleJSON(JSON.parse(event.data));
    return;
  }
  const blob = new Blob([event.data], { type: 'image/jpeg' });
  const url  = URL.createObjectURL(blob);
  const img  = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);   // prevent memory leak
  };
  img.src = url;
};
```

### Input capture

```jsx
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = 1280 / rect.width;
  const scaleY = 720  / rect.height;
  ws.send(JSON.stringify({
    type: 'click',
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top)  * scaleY),
  }));
});
```

Mouse move is throttled using `requestAnimationFrame` or a 16ms debounce — not sent raw (would flood the WebSocket).

---

## 12. Project Structure

```
remote-browser/
├── docker/
│   └── Dockerfile              # custom Chromium image
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express + ws server entry
│   │   ├── session-manager.ts  # Docker lifecycle (dockerode)
│   │   ├── browser-bridge.ts   # Puppeteer + CDP + screenshot loop
│   │   ├── ws-relay.ts         # WebSocket server, message routing
│   │   └── config.ts           # typed env config (port, fps, quality)
│   └── package.json
├── frontend/
│   ├── pages/
│   │   └── index.tsx           # main UI: button + canvas
│   ├── hooks/
│   │   └── useRemoteBrowser.ts # WS connection + frame rendering logic
│   └── package.json
└── README.md
```

---

## 13. Tradeoffs & Decisions Log

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Screenshot transport | JPEG binary over WS | Base64 string | Binary is ~25% smaller; no encoding overhead on client |
| Browser control | Puppeteer (CDP) | Playwright | Simpler API for single-tab; lighter dependency |
| Container management | dockerode SDK | `child_process.exec('docker run...')` | Programmatic control, proper error handling, no shell injection risk |
| Streaming strategy | Full frame + hash dedup | Tile diff (RemoteWebViewServer) | Tile protocol is overkill for localhost single client |
| Frame rate | 10fps (100ms interval) | 30fps | Balances latency vs CPU; tunable via config |
| Container base | Custom Dockerfile | `ghcr.io/browserless/chromium` directly | Custom image lets us control flags; browserless image studied as reference |
| Input coordinate mapping | Client-side scale transform | Server-side remapping | Keeps server stateless about canvas size |

---

## 14. Senior-level details to call out in submission

These signal "someone who has shipped things":

1. `AutoRemove: true` on the container — it self-deletes even if the backend crashes, preventing zombie containers.
2. Frame hash-dedup — borrowed from RemoteWebViewServer, one line, prevents flooding on static pages.
3. Idle guard — screenshot loop pauses when no client is connected; resumes on reconnect.
4. CDP readiness polling — don't assume Chromium is ready immediately; poll `/json/version` until it responds.
5. `URL.revokeObjectURL()` after each frame render — prevents memory leak on the canvas.
6. Named modules (`SessionManager`, `BrowserBridge`, `WSRelay`) — named abstractions before writing them, architecture documented before code.
7. Typed session object — not a loose bag of variables; a `Session` interface with `containerId`, `startedAt`, `puppeteerBrowser`, `screenshotInterval`.

---

## 15. What's next (honest stretch goals)

If time allows, in priority order:

1. URL bar in the UI — let the user navigate to any page, not just a blank tab
2. MJPEG stream via HTTP — instead of WS binary frames; even simpler on the client side
3. Session timeout — auto-kill container after N minutes of inactivity
4. Multi-tab support — open a second `page` inside the same browser instance
5. WebRTC stream — actual video instead of JPEG frames; dramatically better latency

---

*PRD written with full context of open source audit (browserless/browserless, strange-v/RemoteWebViewServer), tradeoff analysis, and deliberate scope decisions. Implementation complete — see `remote-browser/docs/ARCHITECTURE.md` for engineering log.*
