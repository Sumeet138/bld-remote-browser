import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * RED: src/util/waitForReady.ts doesn't exist yet.
 *
 * waitForReady polls GET {url} until it returns 200.
 * Chromium takes ~500ms-2s to boot inside Docker.
 * Without this poll, puppeteer.connect() races and fails.
 *
 * Contract:
 *   - resolves when fetch returns 200
 *   - throws after maxAttempts consecutive failures
 *   - waits intervalMs between attempts
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('waitForReady', () => {
  it('resolves immediately when first fetch returns 200', async () => {
    const { waitForReady } = await import('../../src/util/waitForReady.js');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await expect(
      waitForReady('http://localhost:9222/json/version', { intervalMs: 10, maxAttempts: 3 }),
    ).resolves.toBeUndefined();
  });

  it('retries and resolves when fetch eventually returns 200', async () => {
    const { waitForReady } = await import('../../src/util/waitForReady.js');

    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200 });

    vi.stubGlobal('fetch', mockFetch);

    await expect(
      waitForReady('http://localhost:9222/json/version', { intervalMs: 10, maxAttempts: 5 }),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws after maxAttempts failures', async () => {
    const { waitForReady } = await import('../../src/util/waitForReady.js');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(
      waitForReady('http://localhost:9222/json/version', { intervalMs: 10, maxAttempts: 3 }),
    ).rejects.toThrow(/not ready after/i);
  });

  it('throws if all fetches return non-200', async () => {
    const { waitForReady } = await import('../../src/util/waitForReady.js');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(
      waitForReady('http://localhost:9222/json/version', { intervalMs: 10, maxAttempts: 2 }),
    ).rejects.toThrow(/not ready after/i);
  });
});
