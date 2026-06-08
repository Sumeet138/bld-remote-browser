import { EventEmitter } from 'events';
import type { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from './logger.js';

const log = createLogger('WSRelay');

/**
 * WSRelay owns the WebSocket server.
 *
 * Responsibilities:
 *   - Track connected WS clients
 *   - broadcastFrame(buf) — send binary JPEG to ALL connected clients
 *   - sendJSON(msg) — send a JSON control message to ALL clients
 *   - Emit 'connect' / 'disconnect' events for BrowserBridge to act on
 *   - Emit 'message' event with parsed JSON when client sends input
 *
 * Extends EventEmitter so BrowserBridge can listen without circular deps:
 *   relay.on('message', (msg) => handleInput(msg, page))
 *   relay.on('disconnect', () => sessionManager.killSession())
 *
 * `perMessageDeflate: false` is set on the WebSocketServer (in index.ts)
 * to avoid compression overhead on binary JPEG frames (already compressed).
 * See docs/ARCHITECTURE.md — reduces latency on localhost.
 */
export class WSRelay extends EventEmitter {
  private clients: Set<WebSocket> = new Set();

  constructor(private wss: WebSocketServer) {
    super();
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    log.debug('WSRelay initialized');
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Send raw binary JPEG buffer to all connected clients. */
  broadcastFrame(buf: Buffer): void {
    if (this.clients.size === 0) return;
    log.trace({ bytes: buf.length, clients: this.clients.size }, 'broadcasting frame');
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(buf);
      }
    }
  }

  /** Send a JSON control message to all connected clients. */
  sendJSON(msg: object): void {
    const payload = JSON.stringify(msg);
    log.debug({ type: (msg as any).type }, 'sending JSON to all clients');
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload);
      }
    }
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    log.info({ clientCount: this.clientCount }, 'client connected');
    this.emit('connect', ws);

    ws.on('message', (data) => {
      const raw = data.toString();
      try {
        const msg = JSON.parse(raw);
        log.debug({ type: msg.type }, 'received input message');
        this.emit('message', msg);
      } catch {
        log.warn({ raw }, 'received non-JSON message — ignoring');
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      log.info({ clientCount: this.clientCount }, 'client disconnected');
      this.emit('disconnect');
    });

    ws.on('error', (err) => {
      log.error({ err }, 'client WS error');
      this.clients.delete(ws);
    });
  }
}
