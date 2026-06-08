import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { execSync } from 'child_process';
import { createLogger } from './logger.js';
import { config } from './config.js';
import { SessionManager } from './session-manager.js';
import { WSRelay } from './ws-relay.js';
import { BrowserBridge } from './browser-bridge.js';

const log = createLogger('Server');

export const app = express();
app.use(cors({ origin: '*' })); // dev-only — tighten for prod
app.use(express.json());

// Singletons — shared across routes + WS layer
export const sessionManager = new SessionManager();
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
export const wsRelay = new WSRelay(wss);
export const bridge = new BrowserBridge(wsRelay);

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Session REST API ───────────────────────────────────────────────────────

/** GET /session — returns current session state */
app.get('/session', (_req, res) => {
  const session = sessionManager.getSession();
  if (!session) {
    res.json({ active: false });
    return;
  }
  res.json({
    active: true,
    containerId: session.containerId,
    hostPort: session.hostPort,
    startedAt: session.startedAt,
  });
});

/** POST /session/start — spins up Docker container + Chromium + connects bridge */
app.post('/session/start', async (_req, res) => {
  try {
    const session = await sessionManager.startSession();
    log.info({ containerId: session.containerId }, 'session started via REST');

    // Connect Puppeteer to Chromium CDP after container is ready
    await bridge.connect(session.hostPort);

    // Notify any connected WS clients that the session is ready
    wsRelay.sendJSON({ type: 'session_ready', sessionId: session.containerId });

    res.status(201).json({
      containerId: session.containerId,
      hostPort: session.hostPort,
      startedAt: session.startedAt,
    });
  } catch (err: any) {
    log.error({ err }, 'failed to start session');
    res.status(409).json({ error: err.message });
  }
});

/** DELETE /session/stop — force-kills active container */
app.delete('/session/stop', async (_req, res) => {
  try {
    await sessionManager.killSession();
    log.info('session stopped via REST');
    res.status(204).send();
  } catch (err: any) {
    log.error({ err }, 'failed to stop session');
    res.status(500).json({ error: err.message });
  }
});

// ── HTTP server + WS upgrade ─────────────────────────────────────────────────
export const server = createServer(app);

// Upgrade HTTP connections to WebSocket for the /ws path
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Late-joining WS clients: session_ready may have been sent before they connected
wsRelay.on('connect', (ws) => {
  const session = sessionManager.getSession();
  if (session) {
    ws.send(JSON.stringify({ type: 'session_ready', sessionId: session.containerId }));
    log.debug({ containerId: session.containerId }, 'sent session_ready to new WS client');
  }
});

// On WS disconnect: bridge + session cleanup
// Disconnect cleanup — see docs/ARCHITECTURE.md §2 (session lifecycle)
wsRelay.on('disconnect', async () => {
  log.info('WS client disconnected — tearing down session');
  await bridge.disconnect();
  await sessionManager.killSession();
  wsRelay.sendJSON({ type: 'session_ended' });
});

// Only listen when run directly (not imported by tests)
if (process.env.NODE_ENV !== 'test') {
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      log.warn({ port: config.port }, 'port in use — killing occupant and retrying');
      try {
        execSync(
          `for /f "tokens=5 delims= " %a in ('netstat -ano ^| findstr :${config.port} ^| findstr LISTENING') do taskkill /F /PID %a`,
          { shell: 'cmd.exe', stdio: 'ignore' },
        );
      } catch { /* no process found, ignore */ }
      setTimeout(() => server.listen(config.port), 500);
    } else {
      log.error({ err }, 'server listen error');
      process.exit(1);
    }
  });

  server.listen(config.port, () => {
    log.info({ port: config.port }, 'server listening');
  });

  // Graceful shutdown — runs when terminal closes or Ctrl+C is pressed.
  // Without this, tsx watch's child node process stays alive after the
  // parent is killed, which holds port 3001 until the machine reboots.
  async function shutdown(signal: string) {
    log.info({ signal }, 'shutting down');
    await sessionManager.killSession().catch(() => {});
    await bridge.disconnect().catch(() => {});
    server.close(() => {
      log.info('server closed');
      process.exit(0);
    });
    // Force exit if server.close hangs (open WS connections etc.)
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows: Ctrl+C in some terminals fires this instead
  process.on('SIGHUP',  () => shutdown('SIGHUP'));
}
