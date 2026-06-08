/**
 * Typed environment config. All process.env access lives here.
 * Import this — never access process.env directly elsewhere.
 */
export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info', // use LOG_LEVEL=debug for verbose output
  logPretty: process.env.LOG_PRETTY !== 'false',
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Viewport locked to 1280×720 — matches Chromium --window-size flag
  viewport: { width: 1280, height: 720 },

  // Screenshot / screencast tuning
  jpeg: { quality: 75 },
  stream: {
    minFrameIntervalMs: 33, // ~30fps
    everyNthFrame: 1,
  },

  // Docker + CDP
  docker: {
    chromiumImage: 'bld-chromium', // local image name — built from docker/Dockerfile
    cdpPort: 9222,
  },

  // Session lifecycle
  session: {
    cdpReadyPollIntervalMs: 200,
    cdpReadyMaxAttempts: 15,
  },
} as const;
