import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { type Browser, type Page, type CDPSession } from 'puppeteer-core';
import { createLogger } from './logger.js';
import { config } from './config.js';
import { FrameProcessor } from './frame-processor.js';
import { handleInput } from './input-handler.js';
import type { WSRelay } from './ws-relay.js';

const log = createLogger('BrowserBridge');

// Register the stealth plugin — handles 20+ detection vectors automatically
puppeteer.use(StealthPlugin());

/**
 * BrowserBridge owns Puppeteer.
 *
 * Responsibilities:
 *   - Connect to Chromium via CDP (puppeteer.connect)
 *   - Apply stealth evasions via puppeteer-extra-plugin-stealth
 *   - Start CDP screencast (Page.startScreencast)
 *   - On each screencastFrame: ACK, dedup, broadcast via WSRelay
 *   - Forward input events from WSRelay to Puppeteer page
 *   - Follow new tabs automatically (targetcreated)
 *   - Stop screencast + disconnect on session end
 */
export class BrowserBridge {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private frameProcessor = new FrameProcessor();
  private inputHandler: ((msg: any) => Promise<void>) | null = null;

  constructor(private relay: WSRelay) {}

  /**
   * Connect to Chromium via the CDP WebSocket endpoint.
   * Call after SessionManager.waitForReady() confirms Chromium is up.
   */
  async connect(hostPort: number): Promise<void> {
    const browserURL = `http://127.0.0.1:${hostPort}`;
    log.info({ browserURL }, 'connecting to Chromium via CDP');

    this.browser = await puppeteer.connect({ browserURL }) as unknown as Browser;

    // Create a fresh page FIRST — stealth plugin injects all evasions here
    // Must happen before closing old tabs, otherwise Chromium exits
    this.page = await this.browser.newPage();

    // Now close pre-existing tabs (stealth wasn't applied to them)
    const existingPages = await this.browser.pages();
    for (const p of existingPages) {
      if (p !== this.page) {
        await p.close().catch(() => {});
      }
    }

    await this.page.setViewport({
      width: config.viewport.width,
      height: config.viewport.height,
    });

    log.info({ viewport: config.viewport }, 'Chromium connected with stealth, starting screencast');
    await this.startScreencast();

    // Remove any stale listener from a previous connect() call
    this.relay.removeAllListeners('message');

    // Wire input events from WSRelay to page
    this.inputHandler = async (msg: any) => {
      if (!this.page) return;
      try {
        await handleInput(msg, this.page);
      } catch (err: any) {
        if (err?.name === 'TargetCloseError' || err?.message?.includes('Target closed')) {
          log.warn('target closed — disabling input handler');
          this.page = null;
          if (this.inputHandler) {
            this.relay.removeListener('message', this.inputHandler);
            this.inputHandler = null;
          }
          return;
        }
        log.error({ err, type: msg?.type }, 'input handling error');
      }
    };
    this.relay.on('message', this.inputHandler);

    // --- Follow new tabs ---
    this.browser.on('targetcreated', async (target) => {
      if (target.type() !== 'page') return;
      try {
        const newPage = await target.page();
        if (!newPage || newPage === this.page) return;

        log.info('new tab detected — switching screencast');
        await this.stopScreencast();

        this.page = newPage;
        await this.page.setViewport({
          width: config.viewport.width,
          height: config.viewport.height,
        });
        await this.startScreencast();
        log.info('screencast switched to new tab');
      } catch (err) {
        log.error({ err }, 'failed to switch to new tab');
      }
    });
  }

  private async startScreencast(): Promise<void> {
    if (!this.page) return;

    await this.stopScreencast();

    const cdpSession = await this.page.createCDPSession();
    this.cdpSession = cdpSession;
    let lastFrameMs = 0;

    cdpSession.on('Page.screencastFrame', async (evt: any) => {
      cdpSession.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {});

      const jpegBuf = Buffer.from(evt.data, 'base64');
      if (!this.frameProcessor.shouldSend(jpegBuf, this.relay.clientCount)) return;

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

  private async stopScreencast(): Promise<void> {
    if (!this.cdpSession) return;
    try {
      await this.cdpSession.send('Page.stopScreencast');
      await this.cdpSession.detach();
    } catch {
      // session may already be closed
    }
    this.cdpSession = null;
    this.frameProcessor.reset();
  }

  async disconnect(): Promise<void> {
    if (!this.browser) return;
    log.info('disconnecting from Chromium');

    if (this.inputHandler) {
      this.relay.removeListener('message', this.inputHandler);
      this.inputHandler = null;
    }

    await this.stopScreencast();
    try {
      await this.browser.disconnect();
    } catch (err) {
      log.debug({ err }, 'browser disconnect error (may already be closed)');
    }
    this.browser = null;
    this.page = null;
  }
}
