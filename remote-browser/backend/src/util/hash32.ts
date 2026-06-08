/**
 * Fast sampled hash for JPEG frame dedup.
 * Pattern from streaming OSS audit — see docs/ARCHITECTURE.md §1.
 *
 * Samples every 16th byte using a FNV-style mix.
 * Not cryptographic — just needs to be cheap and collision-resistant
 * for consecutive near-identical frames. One line in the hot path.
 *
 * Usage:
 *   const h = hash32(jpegBuffer);
 *   if (h === lastHash) return; // skip identical frame
 *   lastHash = h;
 *   relay.broadcast(jpegBuffer);
 */
export function hash32(buf: Buffer): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < buf.length; i += 16) {
    h ^= buf[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
