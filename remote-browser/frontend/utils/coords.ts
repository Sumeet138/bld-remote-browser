/**
 * Maps canvas-relative CSS coordinates to Chromium viewport coordinates.
 *
 * The canvas renders the browser stream at whatever CSS size the layout
 * assigns (which varies by screen size, zoom, etc.). To correctly
 * dispatch a mouse event to Chromium, we must convert the click position
 * from canvas-CSS space to the fixed 1280×720 viewport space.
 *
 * @param clientX  - MouseEvent.clientX (page CSS pixels)
 * @param clientY  - MouseEvent.clientY (page CSS pixels)
 * @param rect     - canvas.getBoundingClientRect()
 * @param vw       - viewport width (default 1280)
 * @param vh       - viewport height (default 720)
 */
export function scaleCoordinates(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  vw: number,
  vh: number,
): { x: number; y: number } {
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;

  const scaleX = vw / rect.width;
  const scaleY = vh / rect.height;

  const x = Math.round(Math.max(0, Math.min(vw, relX * scaleX)));
  const y = Math.round(Math.max(0, Math.min(vh, relY * scaleY)));

  return { x, y };
}
