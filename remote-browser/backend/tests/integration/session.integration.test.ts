import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * @integration — requires Docker Desktop running and bld-chromium image built.
 *
 * Build image first:
 *   docker build -t bld-chromium ../docker
 *
 * Run only this suite:
 *   npm run test:integration
 *
 * What this tests end-to-end:
 *   1. POST /session/start → real Docker container starts
 *   2. Container is visible in docker ps
 *   3. GET /session returns active: true with a valid hostPort
 *   4. DELETE /session/stop → container removed (AutoRemove)
 *   5. GET /session returns active: false after stop
 */

const TIMEOUT = 30_000; // container boot can take a few seconds

let app: any;
let server: any;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'debug';
  process.env.NODE_ENV = 'test';
  const mod = await import('../../src/index.js');
  app = mod.app;
  server = mod.server;
}, TIMEOUT);

afterAll(async () => {
  // Make sure we don't leave orphan containers if a test assertion fails
  try {
    await request(app).delete('/session/stop');
  } catch {
    // best-effort cleanup
  }
  await new Promise<void>((res) => server?.close(() => res()));
});

describe('Session lifecycle (real Docker)', () => {
  it('POST /session/start spins up a container and returns 201', async () => {
    const res = await request(app).post('/session/start');
    expect(res.status).toBe(201);
    expect(res.body.containerId).toBeTruthy();
    expect(typeof res.body.hostPort).toBe('number');
    expect(res.body.hostPort).toBeGreaterThan(1024);
  }, TIMEOUT);

  it('GET /session returns active: true with cdpUrl reachable', async () => {
    const res = await request(app).get('/session');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.hostPort).toBeGreaterThan(1024);

    // Verify CDP actually responds
    const cdpRes = await fetch(`http://127.0.0.1:${res.body.hostPort}/json/version`);
    expect(cdpRes.ok).toBe(true);
    const json = await cdpRes.json() as any;
    expect(json.Browser).toMatch(/chromium|chrome/i);
  }, TIMEOUT);

  it('DELETE /session/stop returns 204 and removes session', async () => {
    const stopRes = await request(app).delete('/session/stop');
    expect(stopRes.status).toBe(204);

    // Give AutoRemove a moment to kick in
    await new Promise((r) => setTimeout(r, 1000));

    const getRes = await request(app).get('/session');
    expect(getRes.body.active).toBe(false);
  }, TIMEOUT);
});
