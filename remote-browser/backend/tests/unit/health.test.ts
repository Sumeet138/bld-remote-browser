import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Server } from 'http';

/**
 * RED: src/index.ts doesn't exist yet.
 *
 * What we're testing:
 *   1. GET /health returns 200 with { status: 'ok' }
 *   2. Response has correct Content-Type
 */

let server: Server;
let app: Express.Application;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent'; // no log noise during tests
  process.env.NODE_ENV = 'test';    // prevent server.listen() from firing
  const mod = await import('../../src/index.js');
  app = (mod as any).app;
  server = (mod as any).server;
});

afterAll(async () => {
  await new Promise<void>((res) => server?.close(() => res()));
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
