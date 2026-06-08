import type { Page } from 'puppeteer-core';
import { createLogger } from './logger.js';

const log = createLogger('InputHandler');

/**
 * Supported input event shapes (from PRD section 7.2).
 */
type InputEvent =
  | { type: 'click'; x: number; y: number; button?: string }
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'keydown'; key: string }
  | { type: 'type'; text: string }
  | { type: 'navigate'; url: string };

/**
 * Maps WS JSON input messages to Puppeteer page calls.
 *
 * This is a pure function: takes an event + page, fires the correct
 * Puppeteer API call. No state, no side effects beyond the page.
 *
 * Using Puppeteer's high-level API (page.mouse, page.keyboard) rather
 * than raw CDP Input.dispatchMouseEvent — Puppeteer handles button
 * state, modifier keys, and event ordering correctly.
 *
 * These are desktop events (NOT touch), unlike RWV which uses
 * Input.dispatchTouchEvent for embedded ESP32 clients.
 */
export async function handleInput(event: InputEvent, page: Page): Promise<void> {
  log.debug({ type: event.type }, 'handling input');

  switch (event.type) {
    case 'click':
      await page.mouse.click(event.x, event.y);
      break;

    case 'mousemove':
      await page.mouse.move(event.x, event.y);
      break;

    case 'scroll':
      await page.mouse.wheel({ deltaY: event.deltaY });
      break;

    case 'keydown':
      await page.keyboard.press(event.key as any);
      break;

    case 'type':
      await page.keyboard.type(event.text);
      break;

    case 'navigate':
      await page.goto(event.url, { waitUntil: 'domcontentloaded' });
      break;

    default:
      log.warn({ event }, 'unknown input event type — ignoring');
  }
}
