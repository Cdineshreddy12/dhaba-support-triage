import { loadConfig } from './config.js';
import { createLogger, LogLevel } from './log.js';
import { buildServer } from './server.js';

/** Process entrypoint. Kept apart from buildServer so tests import without listening. */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel as LogLevel);

  const app = buildServer({ config, logger });
  await app.listen({ port: config.port, host: '0.0.0.0' });

  logger.info('listening', { mode: config.mode, port: config.port });
}

main().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      msg: 'failed to start',
      error: error instanceof Error ? error.message : String(error),
    }) + '\n',
  );
  process.exit(1);
});
