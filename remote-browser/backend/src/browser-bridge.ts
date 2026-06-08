import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createLogger } from './logger.js';
import { config } from './config.js';
import { FrameProcessor } from './frame-processor.js';
import { handleInput } from './input-handler.js';
import type { WSRelay } from './ws-relay.js';

const log = createLogger('BrowserBridge');

/**
 * BrowserBridge owns Puppeteer.
 *
 * Responsibilities:
 *   - Connect to Chromium via CDP (puppeteer.connect)
 *   - Start CDP screencast (Page.startScreencast)
 *   - On each screencastFrame: ACK, dedup, broadcast via WSRelay
 *   - Forward input events from WSRelay to Puppeteer page
 *   - Stop screencast + disconnect on session end
 *
 * Key patterns:
 *   - Page.startScreencast (push) vs screenshot polling (pull)
 *     → Push means Chromium sends frames when ready; no tight loop
 *     → Immediate ACK (screencastFrameAck) keeps producer running
 *     → See docs/ARCHITECTURE.md §1 (screencast push model)
 *
 *   - FrameProcessor handles dedup + idle guard
 *     → Separated so it's independently testable
 *
 *   - Throttle: minFrameIntervalMs prevents CPU melt at 60fps screencast
 */
export class BrowserBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private frameProcessor = new FrameProcessor();

  constructor(private relay: WSRelay) {}

  /**
   * Connect to Chromium via the CDP WebSocket endpoint.
   * Call after SessionManager.waitForReady() confirms Chromium is up.
   */
  async connect(hostPort: number): Promise<void> {
    const browserURL = `http://127.0.0.1:${hostPort}`;
    log.info({ browserURL }, 'connecting to Chromium via CDP');

    this.browser = await puppeteer.connect({ browserURL });
    const pages = await this.browser.pages();
    this.page = pages[0] ?? (await this.browser.newPage());

    await this.page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height,
    });

    log.info({ viewport: config.viewport }, 'Chromium connected, starting screencast');
    await this.startScreencast();

    // Wire input events from WSRelay to page
    this.relay.on('message', async (msg: any) => {
      if (!this.page) return;
      try {
        await handleInput(msg, this.page);
      } catch (err) {
        log.error({ err, msg }, 'input handling error');
      }
    });
  }

  private async startScreencast(): Promise<void> {
    if (!this.page) return;
    const cdpSession = await this.page.createCDPSession();
    let lastFrameMs = 0;

    cdpSession.on('Page.screencastFrame', async (evt: any) => {
      // ACK IMMEDIATELY — keeps Chromium's frame pipeline running
      // If we don't ACK, Chromium stops sending frames
      cdpSession.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {});

      // Idle guard + dedup handled by FrameProcessor
      const jpegBuf = Buffer.from(evt.data, 'base64');
      if (!this.frameProcessor.shouldSend(jpegBuf, this.relay.clientCount)) return;

      // Throttle: don't send faster than minFrameIntervalMs
      const now = Date.now();
      if (now - lastFrameMs < config.stream.minFrameIntervalMs) return;
      lastFrameMs = now;

      this.relay.broadcastFrame(jpegBuf);
      log.trace({ bytes: jpegBuf.length }, 'frame broadcast');
    });

    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: config.jpeg.quality,
      maxWidth: config.viewport.width,
      maxHeight: config.viewport.height,
      everyNthFrame: config.stream.everyNthFrame,
    });

    log.info('screencast started');
  }

  async disconnect(): Promise<void> {
    if (!this.browser) return;
    log.info('disconnecting from Chromium');
    this.frameProcessor.reset();
    try {
      await this.browser.disconnect();
    } catch (err) {
      log.debug({ err }, 'browser disconnect error (may already be closed)');
    }
    this.browser = null;
    this.page = null;
  }
}
