import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
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

const TICKETS_FILE = 'fixtures/dhaba_tickets.json';

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

  const service = new TriageService({
    provider,
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: config.confidenceFloor,
    shedder: new LoadShedder(config.maxConcurrentModelCalls),
  });

  // Fastify's own logger is off: it prints request URLs and headers, and we
  // control exactly what reaches a log line. See src/log.ts.
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });

  // Demo console. Served only if web/dist exists, so the API never depends on
  // the UI being built and `npm test` is unaffected either way.
  const webDist = resolve('web/dist');
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, prefix: '/' });
  }

  /** Demo data source for the console: the fixture inbox, unmodified. */
  app.get('/tickets', async (_request, reply) => {
    if (!existsSync(TICKETS_FILE)) return reply.code(404).send({ error: 'fixtures_missing' });
    const raw = JSON.parse(readFileSync(TICKETS_FILE, 'utf8')) as { tickets: unknown[] };
    return reply.send(raw.tickets.map((t) => Ticket.parse(t)));
  });

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
