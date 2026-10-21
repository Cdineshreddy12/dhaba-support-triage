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
import { LoadShedder } from './service/load-shedder.js';
import { Metrics } from './service/metrics.js';

export interface BuildOptions {
  config?: Config;
  provider?: ModelProvider;
  logger?: Logger;
}

export function buildProvider(config: Config): ModelProvider {
  if (config.mode === 'replay') return new ReplayProvider();
  if (!config.apiKey) throw new Error('live mode requires ANTHROPIC_API_KEY');

  return new AnthropicProvider({
    apiKey: config.apiKey,
    model: config.model,
    effort: config.effort,
  });
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel as LogLevel);
  const provider = options.provider ?? buildProvider(config);

  const metrics = new Metrics();

  const service = new TriageService({
    provider,
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: config.confidenceFloor,
    shedder: new LoadShedder(config.maxConcurrentModelCalls),
    metrics,
  });

  // Fastify's own logger is off: it prints request URLs and headers, and we
  // control exactly what reaches a log line. See src/log.ts.
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    // A ticket is a few KB. 1MB of it is not a ticket.
    bodyLimit: 256 * 1024,
    // A request that has not finished in a minute is not going to.
    requestTimeout: 60_000,
  });

  // Off unless a token is configured, so a clean clone runs without one.
  if (config.authToken) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'GET') return;
      if (request.headers.authorization !== `Bearer ${config.authToken}`) {
        logger.warn('rejected unauthenticated request', {
          request_id: request.id,
          status_code: 401,
        });
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });
  }

  app.get('/', async () => ({
    service: 'dhaba-support-triage',
    endpoints: ['POST /triage', 'GET /metrics', 'GET /healthz', 'GET /readyz'],
  }));

  app.get('/healthz', async () => ({ status: 'ok' }));

  /** The numbers from the README's dashboard answer, counted rather than proposed. */
  app.get('/metrics', async () => metrics.snapshot());

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
      // Paths only. A rejected value may be ticket text.
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

      // We hold ourselves to the contract we publish, and it catches assembly
      // bugs in tests rather than in a support agent's UI.
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
