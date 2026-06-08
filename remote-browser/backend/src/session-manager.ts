import Dockerode from 'dockerode';
import { createLogger } from './logger.js';
import { config } from './config.js';
import { waitForReady } from './util/waitForReady.js';

const log = createLogger('SessionManager');

/**
 * Typed session object.
 * A "loose bag of variables" is a code smell — we define an interface.
 * See docs/ARCHITECTURE.md §1 — session model informed by browserless audit.
 */
export interface Session {
  containerId: string;
  hostPort: number;
  startedAt: Date;
  cdpUrl: string;
}

/**
 * SessionManager owns Docker.
 *
 * Responsibilities:
 *   - Spin up a Chromium container on demand (startSession)
 *   - Poll until CDP port is ready (waitForReady)
 *   - Tear down container on disconnect or explicit stop (killSession)
 *   - Expose current session state for REST and WS layers
 *
 * Key patterns (docs/ARCHITECTURE.md §1 — browserless audit):
 *   - Synchronous map eviction BEFORE await container.stop() — prevents
 *     stale GET /session response during teardown race
 *   - AutoRemove: true — container self-deletes even if backend crashes
 *   - HostPort '0' — Docker assigns a free ephemeral port automatically
 */
export class SessionManager {
  private docker: Dockerode;
  private session: Session | null = null;
  private containerRef: Dockerode.Container | null = null;

  /**
   * Accept optional docker instance for dependency injection in tests.
   * Production code calls new SessionManager() with no args.
   */
  constructor(docker?: Dockerode) {
    this.docker = docker ?? new Dockerode();
    log.debug('SessionManager initialized');
  }

  getSession(): Session | null {
    return this.session;
  }

  async startSession(): Promise<Session> {
    if (this.session !== null) {
      throw new Error('Session already active — call killSession() first');
    }

    log.info({ image: config.docker.chromiumImage }, 'creating container');

    const container = await this.docker.createContainer({
      Image: config.docker.chromiumImage,
      ExposedPorts: { '9222/tcp': {} },
      HostConfig: {
        AutoRemove: true,
        PortBindings: {
          '9222/tcp': [{ HostPort: '0' }], // '0' → Docker picks free port
        },
        // Chromium crashes without enough /dev/shm — see docs/ARCHITECTURE.md
        ShmSize: 1 * 1024 * 1024 * 1024, // 1 GB
      },
    });

    log.info({ containerId: container.id }, 'starting container');
    const startedAt = new Date();
    await container.start();

    // Inspect to find the actual host port Docker assigned
    const info = await container.inspect();
    const portInfo = info.NetworkSettings.Ports['9222/tcp']?.[0];
    if (!portInfo) {
      await container.stop();
      throw new Error('Docker did not assign a host port for 9222/tcp');
    }
    const hostPort = parseInt(portInfo.HostPort, 10);
    const cdpUrl = `http://127.0.0.1:${hostPort}/json/version`;

    log.info({ containerId: container.id, hostPort }, 'container running, polling CDP');

    // Wait until Chromium's debug port accepts connections
    await waitForReady(cdpUrl, {
      intervalMs: config.session.cdpReadyPollIntervalMs,
      maxAttempts: config.session.cdpReadyMaxAttempts,
    });

    const session: Session = {
      containerId: container.id,
      hostPort,
      startedAt,
      cdpUrl,
    };

    this.session = session;
    this.containerRef = container;

    const durationMs = Date.now() - startedAt.getTime();
    log.info({ containerId: container.id, hostPort, durationMs }, 'session ready');

    return session;
  }

  async killSession(): Promise<void> {
    if (!this.session || !this.containerRef) {
      log.debug('killSession called but no active session');
      return;
    }

    const { containerId } = this.session;

    // Sync eviction FIRST — see docs/ARCHITECTURE.md §3
    // GET /session checks this.session — clear it before await stop()
    // so concurrent requests don't see a stale "active" state.
    this.session = null;
    const container = this.containerRef;
    this.containerRef = null;

    log.info({ containerId }, 'stopping container');
    try {
      await container.stop();
      log.info({ containerId }, 'container stopped (AutoRemove will delete it)');
    } catch (err: any) {
      // Container may have already exited — that's fine
      if (err?.statusCode === 304 || err?.statusCode === 404) {
        log.debug({ containerId }, 'container already stopped');
      } else {
        log.error({ containerId, err }, 'error stopping container');
        throw err;
      }
    }
  }
}
