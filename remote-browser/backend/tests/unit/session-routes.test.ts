import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

/**
 * Session routes tests.
 *
 * Strategy: import app + sessionManager once, then use vi.spyOn to
 * control individual method behavior per test.
 * This avoids module reset / mock hoisting issues.
 */

const mockSession = {
  containerId: 'test-container-id',
  hostPort: 49300,
  startedAt: new Date('2026-01-01T00:00:00Z'),
  cdpUrl: 'http://127.0.0.1:49300/json/version',
};

// Mock Dockerode + waitForReady at top level so SessionManager constructor
// doesn't try to connect to a real Docker socket
vi.mock('dockerode', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/util/waitForReady.js', () => ({
  waitForReady: vi.fn().mockResolvedValue(undefined),
}));

describe('Session REST routes', () => {
  let app: any;
  let sessionManager: any;
  let bridge: any;

  beforeEach(async () => {
    const mod = await import('../../src/index.js');
    app = mod.app;
    sessionManager = mod.sessionManager;
    bridge = mod.bridge;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /session returns { active: false } when no session', async () => {
    vi.spyOn(sessionManager, 'getSession').mockReturnValue(null);

    const res = await request(app).get('/session');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('GET /session returns active session data', async () => {
    vi.spyOn(sessionManager, 'getSession').mockReturnValue(mockSession);

    const res = await request(app).get('/session');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.containerId).toBe('test-container-id');
    expect(res.body.hostPort).toBe(49300);
  });

  it('POST /session/start returns 201 with session data', async () => {
    vi.spyOn(sessionManager, 'startSession').mockResolvedValue(mockSession);
    vi.spyOn(bridge, 'connect').mockResolvedValue(undefined);

    const res = await request(app).post('/session/start');
    expect(res.status).toBe(201);
    expect(res.body.containerId).toBe('test-container-id');
    expect(res.body.hostPort).toBe(49300);
  });

  it('POST /session/start returns 409 if session already active', async () => {
    vi.spyOn(sessionManager, 'startSession').mockRejectedValue(
      new Error('Session already active — call killSession() first'),
    );

    const res = await request(app).post('/session/start');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already active/i);
  });

  it('DELETE /session/stop returns 204', async () => {
    vi.spyOn(sessionManager, 'killSession').mockResolvedValue(undefined);

    const res = await request(app).delete('/session/stop');
    expect(res.status).toBe(204);
  });
});
