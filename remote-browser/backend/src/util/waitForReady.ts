import { createLogger } from '../logger.js';

const log = createLogger('waitForReady');

interface WaitOptions {
  intervalMs: number;
  maxAttempts: number;
}

/**
 * Polls GET {url} until it returns HTTP 200.
 * Used after `container.start()` to wait for Chromium's CDP endpoint.
 *
 * Why we need this:
 *   Docker starts the container immediately, but Chromium takes 500ms–2s
 *   to initialize its debug port. If we call puppeteer.connect() too early,
 *   we get ECONNREFUSED. Polling is the standard workaround.
 *
 * CDP readiness poll — see docs/ARCHITECTURE.md §2.
 */
export async function waitForReady(url: string, opts: WaitOptions): Promise<void> {
  const { intervalMs, maxAttempts } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        log.debug({ url, attempt }, 'CDP endpoint ready');
        return;
      }
      log.debug({ url, attempt, status: res.status }, 'CDP not ready yet');
    } catch (err) {
      log.debug({ url, attempt, err }, 'CDP poll error — retrying');
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(`Chromium not ready after ${maxAttempts} attempts at ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
