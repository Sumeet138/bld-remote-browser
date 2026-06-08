import { describe, it, expect } from 'vitest';

/**
 * RED: utils/coords.ts doesn't exist yet.
 *
 * scaleCoordinates maps client (CSS pixel) coordinates to
 * the 1280×720 Chromium viewport coordinate space.
 *
 * Why this matters:
 *   The canvas renders a JPEG at whatever CSS size the browser assigns.
 *   If the canvas is 640×360 (half size), a click at CSS (100, 50)
 *   should map to (200, 100) in Chromium's coordinate space.
 *
 *   Without scaling: clicks land in wrong locations.
 *   This is a pure function, easy to test without DOM.
 */
describe('scaleCoordinates', () => {
  it('returns 1:1 when canvas matches viewport exactly', async () => {
    const { scaleCoordinates } = await import('../../utils/coords');
    const rect = { left: 0, top: 0, width: 1280, height: 720 };
    expect(scaleCoordinates(100, 50, rect, 1280, 720)).toEqual({ x: 100, y: 50 });
  });

  it('scales up when canvas is smaller than viewport', async () => {
    const { scaleCoordinates } = await import('../../utils/coords');
    // Canvas is half size (640×360), viewport is 1280×720
    const rect = { left: 0, top: 0, width: 640, height: 360 };
    expect(scaleCoordinates(100, 50, rect, 1280, 720)).toEqual({ x: 200, y: 100 });
  });

  it('subtracts canvas offset before scaling', async () => {
    const { scaleCoordinates } = await import('../../utils/coords');
    // Canvas starts at CSS (50, 25), size 640×360
    const rect = { left: 50, top: 25, width: 640, height: 360 };
    // Client click at (150, 75) → relative (100, 50) → scaled (200, 100)
    expect(scaleCoordinates(150, 75, rect, 1280, 720)).toEqual({ x: 200, y: 100 });
  });

  it('clamps coordinates to viewport bounds', async () => {
    const { scaleCoordinates } = await import('../../utils/coords');
    const rect = { left: 0, top: 0, width: 640, height: 360 };
    // Click outside canvas → clamp to 0
    expect(scaleCoordinates(-10, -10, rect, 1280, 720)).toEqual({ x: 0, y: 0 });
    // Click way beyond canvas → clamp to max
    expect(scaleCoordinates(10000, 10000, rect, 1280, 720)).toEqual({ x: 1280, y: 720 });
  });
});
