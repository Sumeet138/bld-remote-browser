import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RED: src/input-handler.ts doesn't exist yet.
 *
 * handleInput maps WSRelay JSON messages to Puppeteer page calls.
 *
 * Input events (from PRD section 7.2):
 *   click    → page.mouse.click(x, y)
 *   mousemove → page.mouse.move(x, y)
 *   scroll   → page.mouse.wheel({ deltaY })
 *   keydown  → page.keyboard.press(key)
 *   type     → page.keyboard.type(text)
 *
 * These are desktop mouse/keyboard events — NOT touch events from RWV.
 * Puppeteer API handles the CDP dispatchMouseEvent/dispatchKeyEvent internally.
 */

function makeMockPage() {
  return {
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('handleInput', () => {
  let handleInput: Awaited<typeof import('../../src/input-handler.js')>['handleInput'];

  beforeEach(async () => {
    const mod = await import('../../src/input-handler.js');
    handleInput = mod.handleInput;
  });

  it('click event calls page.mouse.click with x,y', async () => {
    const page = makeMockPage();
    await handleInput({ type: 'click', x: 100, y: 200 }, page as any);
    expect(page.mouse.click).toHaveBeenCalledWith(100, 200);
  });

  it('mousemove event calls page.mouse.move with x,y', async () => {
    const page = makeMockPage();
    await handleInput({ type: 'mousemove', x: 300, y: 400 }, page as any);
    expect(page.mouse.move).toHaveBeenCalledWith(300, 400);
  });

  it('scroll event calls page.mouse.wheel with deltaY', async () => {
    const page = makeMockPage();
    await handleInput({ type: 'scroll', x: 0, y: 0, deltaY: -120 }, page as any);
    expect(page.mouse.wheel).toHaveBeenCalledWith({ deltaY: -120 });
  });

  it('keydown event calls page.keyboard.press with key', async () => {
    const page = makeMockPage();
    await handleInput({ type: 'keydown', key: 'Enter' }, page as any);
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
  });

  it('type event calls page.keyboard.type with text', async () => {
    const page = makeMockPage();
    await handleInput({ type: 'type', text: 'hello world' }, page as any);
    expect(page.keyboard.type).toHaveBeenCalledWith('hello world');
  });

  it('unknown type does not throw', async () => {
    const page = makeMockPage();
    await expect(
      handleInput({ type: 'unknown_event' } as any, page as any),
    ).resolves.toBeUndefined();
  });
});
