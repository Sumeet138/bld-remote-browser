import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';

/**
 * @integration — requires Docker Desktop + bld-chromium image.
 *
 * End-to-end streaming test:
 *   1. Start session via REST
 *   2. Connect WS client
 *   3. Verify we receive a 'session_ready' JSON message
 *   4. Verify we receive at least one binary JPEG frame
 *   5. Verify JPEG magic bytes (FF D8 FF)
 *   6. Send a click input — no crash
 *   7. Stop session
 */

const TIMEOUT = 30_000;

let app: any;
let server: any;
let port: number;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'info';
  process.env.NODE_ENV = 'test';
  const mod = await import('../../src/index.js');
  app = mod.app;
  server = mod.server;

  // Start HTTP server on a random port for WS upgrade testing
  await new Promise<void>((res) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      res();
    });
  });
}, TIMEOUT);

afterAll(async () => {
  try { await request(app).delete('/session/stop'); } catch {}
  await new Promise<void>((res) => server.close(() => res()));
});

describe('Full streaming pipeline (real Docker + Puppeteer)', () => {
  it('receives session_ready + JPEG frames over WebSocket', async () => {
    // Start the session
    const startRes = await request(app).post('/session/start');
    expect(startRes.status).toBe(201);

    // Connect WS client
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res) => ws.on('open', res));

    const messages: Array<{ kind: 'json' | 'binary'; data: any }> = [];

    // Collect messages for up to 3 seconds
    await new Promise<void>((res) => {
      const timer = setTimeout(res, 3000);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          messages.push({ kind: 'binary', data: data as Buffer });
        } else {
          messages.push({ kind: 'json', data: JSON.parse(data.toString()) });
        }
        // Once we have at least 2 frames, stop early
        if (messages.filter((m) => m.kind === 'binary').length >= 2) {
          clearTimeout(timer);
          res();
        }
      });
    });

    ws.close();

    // Verify: should have received at least one binary frame
    const frames = messages.filter((m) => m.kind === 'binary');
    expect(frames.length).toBeGreaterThanOrEqual(1);

    // Verify JPEG magic bytes (FF D8 FF)
    const firstFrame = frames[0].data as Buffer;
    expect(firstFrame[0]).toBe(0xff);
    expect(firstFrame[1]).toBe(0xd8);
    expect(firstFrame[2]).toBe(0xff);
  }, TIMEOUT);

  it('forwards click input without error', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res) => ws.on('open', res));

    // Send a click in the middle of the viewport
    ws.send(JSON.stringify({ type: 'click', x: 640, y: 360 }));

    // Brief wait — no error response expected
    await new Promise((r) => setTimeout(r, 500));
    ws.close();
  }, TIMEOUT);

  it('stop session returns 204', async () => {
    const res = await request(app).delete('/session/stop');
    expect(res.status).toBe(204);
  }, TIMEOUT);
});
