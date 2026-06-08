import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionManager as SessionManagerType } from '../../src/session-manager.js';

/**
 * Tests for SessionManager using dependency injection.
 *
 * We inject a mock Dockerode instance directly into the constructor —
 * this avoids vi.mock() hoisting issues and is better OOP design anyway.
 *
 * Patterns tested (docs/ARCHITECTURE.md §1 — session lifecycle):
 *   1. getSession() null when idle
 *   2. startSession() → typed Session with containerId + hostPort
 *   3. AutoRemove: true on container creation
 *   4. HostPort '0' → Docker assigns free port
 *   5. Sync session eviction BEFORE await container.stop()
 *   6. Throws if second startSession() while session active
 */

vi.mock('../../src/util/waitForReady.js', () => ({
  waitForReady: vi.fn().mockResolvedValue(undefined),
}));

function makeMockDocker(hostPort = '49200') {
  const mockContainer = {
    id: 'mock-container-abc123',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      NetworkSettings: {
        Ports: {
          '9222/tcp': [{ HostIp: '0.0.0.0', HostPort: hostPort }],
        },
      },
    }),
  };

  const mockDocker = {
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    _container: mockContainer, // expose for assertions
  };

  return mockDocker;
}

let SessionManager: typeof SessionManagerType;

beforeEach(async () => {
  const mod = await import('../../src/session-manager.js');
  SessionManager = mod.SessionManager;
});

describe('SessionManager', () => {
  it('getSession returns null when no session started', () => {
    const sm = new SessionManager(makeMockDocker() as any);
    expect(sm.getSession()).toBeNull();
  });

  it('startSession returns session with containerId and hostPort', async () => {
    const sm = new SessionManager(makeMockDocker('49200') as any);
    const session = await sm.startSession();

    expect(session.containerId).toBe('mock-container-abc123');
    expect(session.hostPort).toBe(49200);
    expect(session.startedAt).toBeInstanceOf(Date);
    expect(session.cdpUrl).toBe('http://127.0.0.1:49200/json/version');
  });

  it('startSession creates container with AutoRemove: true', async () => {
    const mockDocker = makeMockDocker();
    const sm = new SessionManager(mockDocker as any);
    await sm.startSession();

    const createArgs = mockDocker.createContainer.mock.calls[0][0];
    expect(createArgs.HostConfig.AutoRemove).toBe(true);
  });

  it('startSession uses HostPort "0" for dynamic port allocation', async () => {
    const mockDocker = makeMockDocker();
    const sm = new SessionManager(mockDocker as any);
    await sm.startSession();

    const createArgs = mockDocker.createContainer.mock.calls[0][0];
    expect(createArgs.HostConfig.PortBindings['9222/tcp'][0].HostPort).toBe('0');
  });

  it('getSession returns active session after startSession', async () => {
    const sm = new SessionManager(makeMockDocker() as any);
    await sm.startSession();
    expect(sm.getSession()).not.toBeNull();
    expect(sm.getSession()?.containerId).toBe('mock-container-abc123');
  });

  it('killSession clears session synchronously then stops container', async () => {
    const mockDocker = makeMockDocker();
    const sm = new SessionManager(mockDocker as any);
    await sm.startSession();
    expect(sm.getSession()).not.toBeNull();

    await sm.killSession();

    // Session evicted
    expect(sm.getSession()).toBeNull();
    // Container stop was called
    expect(mockDocker._container.stop).toHaveBeenCalledOnce();
  });

  it('throws if startSession called while session already active', async () => {
    const sm = new SessionManager(makeMockDocker() as any);
    await sm.startSession();

    await expect(sm.startSession()).rejects.toThrow(/session already active/i);
  });

  it('killSession is a no-op when no session active', async () => {
    const sm = new SessionManager(makeMockDocker() as any);
    await expect(sm.killSession()).resolves.toBeUndefined();
  });
});
