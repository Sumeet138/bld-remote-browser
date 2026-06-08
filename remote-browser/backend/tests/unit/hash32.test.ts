import { describe, it, expect } from 'vitest';

/**
 * RED: src/util/hash32.ts doesn't exist yet.
 *
 * hash32 is a fast sampled hash (every 16th byte, FNV-style).
 * Used for frame dedup: if hash matches last frame → skip broadcast.
 *
 * Properties we need:
 *   1. Same buffer → same hash (deterministic)
 *   2. Different buffers → different hash (collision-free for our use)
 *   3. Empty buffer → a defined hash (no crash)
 *   4. Returns a number (not string, not bigint)
 */
describe('hash32', () => {
  it('returns the same hash for identical buffers', async () => {
    const { hash32 } = await import('../../src/util/hash32.js');
    const buf = Buffer.from('hello world frame data');
    expect(hash32(buf)).toBe(hash32(buf));
  });

  it('returns different hashes for different buffers', async () => {
    const { hash32 } = await import('../../src/util/hash32.js');
    const a = Buffer.from('frame-A content');
    const b = Buffer.from('frame-B different');
    expect(hash32(a)).not.toBe(hash32(b));
  });

  it('handles empty buffer without throwing', async () => {
    const { hash32 } = await import('../../src/util/hash32.js');
    expect(() => hash32(Buffer.alloc(0))).not.toThrow();
    expect(typeof hash32(Buffer.alloc(0))).toBe('number');
  });

  it('returns a number', async () => {
    const { hash32 } = await import('../../src/util/hash32.js');
    const result = hash32(Buffer.from('test'));
    expect(typeof result).toBe('number');
  });

  it('same bytes in different buffer instances produce same hash', async () => {
    const { hash32 } = await import('../../src/util/hash32.js');
    const a = Buffer.from([1, 2, 3, 4, 5]);
    const b = Buffer.from([1, 2, 3, 4, 5]);
    expect(hash32(a)).toBe(hash32(b));
  });
});
