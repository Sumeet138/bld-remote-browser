import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

/**
 * RED: src/ws-relay.ts doesn't exist yet.
 *
 * WSRelay owns the WebSocket server.
 *
 * Responsibilities:
 *   - Upgrade HTTP server to handle WS connections
 *   - Track connected clients (clientCount)
 *   - broadcastFrame(buf) — send binary JPEG to all connected clients
 *   - send(client, msg) — send JSON to one client
 *   - On client connect: emit 'connect' event
 *   - On client disconnect: emit 'disconnect' event → triggers killSession
 */

vi.mock('../../src/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    getSession: vi.fn().mockReturnValue(null),
    startSession: vi.fn(),
    killSession: vi.fn(),
  })),
}));

vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

describe('WSRelay', () => {
  let WSRelay: Awaited<typeof import('../../src/ws-relay.js')>['WSRelay'];
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    const mod = await import('../../src/ws-relay.js');
    WSRelay = mod.WSRelay;

    // Use a random port for test server
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((res) => wss.on('listening', res));
    port = (wss.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((res) => wss.close(() => res()));
  });

  it('clientCount is 0 on init', () => {
    const relay = new WSRelay(wss);
    expect(relay.clientCount).toBe(0);
  });

  it('clientCount increments on connect, decrements on disconnect', async () => {
    const relay = new WSRelay(wss);

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res) => client.on('open', res));
    expect(relay.clientCount).toBe(1);

    await new Promise<void>((res) => {
      client.on('close', res);
      client.close();
    });
    // Allow the close handler to propagate
    await new Promise((r) => setTimeout(r, 50));
    expect(relay.clientCount).toBe(0);
  });

  it('broadcastFrame sends binary to all connected clients', async () => {
    const relay = new WSRelay(wss);
    const frameData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res) => client.on('open', res));

    const received = await new Promise<Buffer>((res) => {
      client.on('message', (data) => res(data as Buffer));
      relay.broadcastFrame(frameData);
    });

    expect(received).toEqual(frameData);
    client.close();
  });

  it('sendJSON sends stringified JSON to a specific client', async () => {
    const relay = new WSRelay(wss);
    const msg = { type: 'session_ready', sessionId: 'abc123' };

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res) => client.on('open', res));

    const received = await new Promise<string>((res) => {
      client.on('message', (data) => res(data.toString()));
      relay.sendJSON(msg);
    });

    expect(JSON.parse(received)).toEqual(msg);
    client.close();
  });

  it('emits disconnect event when client closes', async () => {
    const relay = new WSRelay(wss);
    const disconnectHandler = vi.fn();
    relay.on('disconnect', disconnectHandler);

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res) => client.on('open', res));

    await new Promise<void>((res) => {
      relay.once('disconnect', res);
      client.close();
    });

    expect(disconnectHandler).toHaveBeenCalledOnce();
  });
});
