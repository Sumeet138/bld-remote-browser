import { hash32 } from './util/hash32.js';
import { createLogger } from './logger.js';

const log = createLogger('FrameProcessor');

/**
 * FrameProcessor decides whether a screencast frame should be broadcast.
 *
 * Two guards (docs/ARCHITECTURE.md §1 — streaming OSS audit):
 *
 * 1. Idle guard — if no WebSocket clients are connected, skip
 *    encode and broadcast. We still ACK the screencast frame to
 *    keep Chromium's frame pipeline alive. Saves CPU when the UI
 *    tab is closed.
 *
 * 2. Hash dedup — compute hash32(frame). If it matches the last
 *    sent hash, the page is static; skip sending identical bytes.
 *    One line of logic, massive practical impact on idle pages.
 *
 * Extracted from BrowserBridge so it's independently unit-testable
 * without a real CDP connection.
 */
export class FrameProcessor {
  private lastHash: number | null = null;

  /**
   * @param frame - raw JPEG buffer from CDP screencastFrame
   * @param clientCount - number of active WebSocket clients
   * @returns true if frame should be broadcast
   */
  shouldSend(frame: Buffer, clientCount: number): boolean {
    // Idle guard: no viewers → skip
    if (clientCount === 0) {
      log.trace({ clientCount }, 'idle guard — no clients, skipping frame');
      return false;
    }

    // Hash dedup: unchanged page → skip
    const h = hash32(frame);
    if (h === this.lastHash) {
      log.trace({ hash: h }, 'frame dedup — hash unchanged, skipping');
      return false;
    }

    this.lastHash = h;
    log.trace({ hash: h, bytes: frame.length }, 'frame changed — will broadcast');
    return true;
  }

  /** Call on session end so next frame after reconnect always sends. */
  reset(): void {
    this.lastHash = null;
    log.debug('frame processor reset');
  }
}
