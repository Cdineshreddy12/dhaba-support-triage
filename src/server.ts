import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, Config } from './config.js';
import { Ticket } from './domain/ticket.js';
import { TriageResponse } from './domain/triage.js';
import { createLogger, Logger, LogLevel } from './log.js';
import { AnthropicProvider } from './llm/anthropic.js';
import { ReplayProvider } from './llm/replay.js';
import { ModelProvider } from './llm/provider.js';
import { IdempotencyGuard, InMemoryDecisionStore } from './service/idempotency.js';
import { TriageService } from './service/triage-service.js';

export interface BuildOptions {
  config?: Config;
  provider?: ModelProvider;
  logger?: Logger;
}

export function buildProvider(config: Config): ModelProvider {
  if (config.mode === 'live') {
    // loadConfig already rejected live-without-key, so this is a type narrowing
    // rather than a runtime check.
    return new AnthropicProvider({
      apiKey: config.apiKey!,
      model: config.model,
      effort: config.effort,
    });
  }
  return new ReplayProvider();
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel as LogLevel);
  const provider = options.provider ?? buildProvider(config);

  const service = new TriageService({
    provider,
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: config.confidenceFloor,
  });

  // Fastify's own logger is off: it prints request URLs and headers, and we
  // control exactly what reaches a log line. See src/log.ts.
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async () => ({
    status: 'ok',
    mode: config.mode,
    model: config.mode === 'live' ? config.model : null,
    replay_fixtures_present: existsSync('fixtures/replay'),
  }));

  app.post('/triage', async (request, reply) => {
    const started = Date.now();
    const requestId = request.id;

    const parsed = Ticket.safeParse(request.body);
    if (!parsed.success) {
      // Issue PATHS only. A rejected value may be ticket text.
      const issues = parsed.error.issues
        .slice(0, 10)
        .map((i) => ({ path: i.path.map(String).join('.') || '<root>', code: i.code }));
      logger.warn('ticket rejected by schema', {
        request_id: requestId,
        status_code: 400,
        validation_issues: issues.map((i) => `${i.path}:${i.code}`).join(', '),
      });
      return reply.code(400).send({ error: 'invalid_ticket', issues });
    }

    try {
      const decision = await service.triage(parsed.data, requestId);

      // We hold ourselves to the contract we publish. This also catches
      // assembly bugs in tests rather than in a support agent's UI.
      const validated = TriageResponse.parse(decision);

      logger.debug('request complete', {
        request_id: requestId,
        ticket_id: validated.ticket_id,
        status_code: 200,
        duration_ms: Date.now() - started,
      });
      return reply.code(200).send(validated);
    } catch (error) {
      // assertSpendable throwing lands here: a rule tried to return money with
      // no capture behind it. Loud, opaque to the caller, and no payout.
      logger.error('triage failed', {
        request_id: requestId,
        ticket_id: parsed.data.id,
        status_code: 500,
        duration_ms: Date.now() - started,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      return reply.code(500).send({ error: 'triage_failed', request_id: requestId });
    }
  });

  return app;
}

// Only start a listener when run directly, so tests can import buildServer.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const config = loadConfig();
  const app = buildServer({ config });
  app.listen({ port: config.port, host: '0.0.0.0' }).then(
    () => process.stdout.write(JSON.stringify({ level: 'info', msg: 'listening', mode: config.mode, port: config.port }) + '\n'),
    (error: unknown) => {
      process.stderr.write(JSON.stringify({ level: 'error', msg: 'failed to start', error: String(error) }) + '\n');
      process.exit(1);
    },
  );
}
