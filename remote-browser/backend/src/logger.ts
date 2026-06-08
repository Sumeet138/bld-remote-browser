import pino from 'pino';

/**
 * Root logger. Level controlled by LOG_LEVEL env (default: 'debug').
 * In dev, LOG_PRETTY=true → human-readable colorized output.
 * In production / tests with LOG_LEVEL=silent, zero output.
 */
const level = process.env.LOG_LEVEL ?? 'info';
const pretty = process.env.LOG_PRETTY === 'true' || process.env.NODE_ENV === 'development';

export const logger = pino(
  { level },
  pretty
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } })
    : undefined,
);

/**
 * Creates a child logger scoped to a named module.
 * Usage:  const log = createLogger('SessionManager');
 *         log.info({ containerId }, 'container started');
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
