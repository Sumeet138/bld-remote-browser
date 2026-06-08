import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RED: src/frame-processor.ts doesn't exist yet.
 *
 * FrameProcessor encapsulates the "should I send this frame?" logic.
 * Separating it from BrowserBridge makes it unit-testable without CDP.
 *
 * Rules (from RWV deviceManager.ts, adapted):
 *   1. Dedup: same hash as last frame → shouldSend: false
 *   2. Idle guard: clientCount === 0 → shouldSend: false (but ACK still happens)
 *   3. First frame always sends (no lastHash yet)
 *   4. Different hash from last → shouldSend: true
 *   5. After reset (new session), treats next frame as first frame
 */

describe('FrameProcessor', () => {
  let FrameProcessor: Awaited<typeof import('../../src/frame-processor.js')>['FrameProcessor'];

  beforeEach(async () => {
    const mod = await import('../../src/frame-processor.js');
    FrameProcessor = mod.FrameProcessor;
  });

  it('first frame always sends (no previous hash)', () => {
    const fp = new FrameProcessor();
    const frame = Buffer.from('jpeg-frame-data-1');
    expect(fp.shouldSend(frame, 1)).toBe(true);
  });

  it('identical frame after first → shouldSend false (dedup)', () => {
    const fp = new FrameProcessor();
    const frame = Buffer.from('identical-frame');
    fp.shouldSend(frame, 1); // first — consume it
    expect(fp.shouldSend(frame, 1)).toBe(false);
  });

  it('different frame after first → shouldSend true', () => {
    const fp = new FrameProcessor();
    // Use buffers that differ in the first byte so hash32 (stride-16) detects the change
    const frameA = Buffer.alloc(32, 0xaa);
    const frameB = Buffer.alloc(32, 0xbb);
    fp.shouldSend(frameA, 1);
    expect(fp.shouldSend(frameB, 1)).toBe(true);
  });

  it('idle guard: 0 clients → shouldSend false regardless of frame content', () => {
    const fp = new FrameProcessor();
    const frame = Buffer.from('new-frame-never-seen');
    expect(fp.shouldSend(frame, 0)).toBe(false);
  });

  it('idle guard: clients become 0 → subsequent frame skipped', () => {
    const fp = new FrameProcessor();
    fp.shouldSend(Buffer.from('frame-1'), 1); // first, 1 client
    expect(fp.shouldSend(Buffer.from('frame-2'), 0)).toBe(false); // 0 clients now
  });

  it('reset() clears hash so next frame is treated as first', () => {
    const fp = new FrameProcessor();
    const frame = Buffer.from('frame-A');
    fp.shouldSend(frame, 1); // sets hash
    fp.reset();
    // same frame after reset → shouldSend true (hash cleared)
    expect(fp.shouldSend(frame, 1)).toBe(true);
  });
});
