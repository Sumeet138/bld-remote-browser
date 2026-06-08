import { describe, it, expect } from 'vitest';

/**
 * RED: logger.ts doesn't exist yet — these tests will fail.
 *
 * What we're testing:
 *   1. Root logger exports exist
 *   2. Child logger carries a `module` field
 *   3. LOG_LEVEL env controls logger level
 */
describe('logger', () => {
  it('exports a root logger instance', async () => {
    const { logger } = await import('../../src/logger.js');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('creates a child logger with module field', async () => {
    const { createLogger } = await import('../../src/logger.js');
    const child = createLogger('TestModule');
    expect(child).toBeDefined();
    expect(typeof child.debug).toBe('function');
    expect(typeof child.error).toBe('function');
  });

  it('child logger carries the module name as a binding', async () => {
    const { createLogger } = await import('../../src/logger.js');
    const child = createLogger('SessionManager');
    // pino child loggers expose bindings()
    const bindings = (child as any).bindings?.();
    expect(bindings?.module).toBe('SessionManager');
  });
});
