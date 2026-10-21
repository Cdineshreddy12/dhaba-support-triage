import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { ReplayProvider } from '../src/llm/replay.js';
import { createLogger } from '../src/log.js';
import { loadConfig } from '../src/config.js';
import { InMemoryDecisionStore } from '../src/service/idempotency.js';
import { Metrics } from '../src/service/metrics.js';
import { ALL_TICKETS, ticket } from './helpers.js';
import type { TriageResponse } from '../src/domain/triage.js';

const base = { ...loadConfig(), mode: 'replay' as const, apiKey: null, confidenceFloor: 0.6 };

function server(overrides: Partial<typeof base> = {}) {
  return buildServer({
    config: { ...base, ...overrides },
    provider: new ReplayProvider(),
    logger: createLogger('error'),
  });
}

describe('the decision store is bounded', () => {
  it('evicts oldest rather than growing without limit', async () => {
    const store = new InMemoryDecisionStore(3);
    const fake = (id: string) => ({ ticket_id: id }) as TriageResponse;

    for (const id of ['a', 'b', 'c', 'd']) await store.put(id, fake(id));

    expect(store.size).toBe(3);
    expect(await store.get('a')).toBeNull(); // evicted
    expect(await store.get('d')).not.toBeNull();
  });

  it('re-storing a known id does not evict anything', async () => {
    const store = new InMemoryDecisionStore(2);
    await store.put('a', {} as TriageResponse);
    await store.put('b', {} as TriageResponse);
    await store.put('a', {} as TriageResponse);

    expect(store.size).toBe(2);
    expect(await store.get('b')).not.toBeNull();
  });
});

describe('metrics are produced, not proposed', () => {
  it('counts the needs_human rate the README names', () => {
    const metrics = new Metrics();
    const decision = (needsHuman: boolean): TriageResponse =>
      ({
        needs_human: needsHuman,
        refund: { decision: 'none', amount_inr: 0 },
        flags: { prompt_injection_suspected: false },
        meta: { degraded: 'none', idempotent_replay: false },
      }) as TriageResponse;

    metrics.record(decision(true));
    metrics.record(decision(true));
    metrics.record(decision(false));
    metrics.record(decision(false));

    expect(metrics.snapshot().needs_human_rate).toBe(0.5);
  });

  it('does not count a replay as a new decision', () => {
    // Otherwise the rate drifts with retry volume rather than triage quality.
    const metrics = new Metrics();
    const replay = {
      needs_human: true,
      refund: { decision: 'none', amount_inr: 0 },
      flags: { prompt_injection_suspected: false },
      meta: { degraded: 'none', idempotent_replay: true },
    } as TriageResponse;

    metrics.record(replay);

    expect(metrics.snapshot().decided).toBe(0);
    expect(metrics.snapshot().idempotent_replays).toBe(1);
  });

  it('GET /metrics reflects real traffic', async () => {
    const app = server();
    for (const t of ALL_TICKETS) {
      await app.inject({ method: 'POST', url: '/triage', payload: t });
    }
    const snapshot = (await app.inject({ method: 'GET', url: '/metrics' })).json();
    await app.close();

    expect(snapshot.decided).toBe(12);
    expect(snapshot.needs_human).toBe(10);
    expect(snapshot.refunded_inr).toBe(1997);
    expect(snapshot.injections_flagged).toBe(2);
  });
});

describe('transport limits', () => {
  const app = server();
  afterAll(async () => {
    await app.close();
  });

  it('rejects a body far larger than any ticket', async () => {
    const huge = { ...ticket('T-1001'), subject: 'x'.repeat(300 * 1024) };
    const response = await app.inject({ method: 'POST', url: '/triage', payload: huge });
    expect(response.statusCode).toBe(413);
  });
});

describe('auth is opt-in', () => {
  it('is open when no token is configured', async () => {
    const app = server({ authToken: null });
    const response = await app.inject({ method: 'POST', url: '/triage', payload: ticket('T-1002') });
    await app.close();
    expect(response.statusCode).toBe(200);
  });

  it('rejects an unauthenticated POST when a token is configured', async () => {
    const app = server({ authToken: 'secret' });
    const response = await app.inject({ method: 'POST', url: '/triage', payload: ticket('T-1002') });
    await app.close();
    expect(response.statusCode).toBe(401);
  });

  it('accepts the right bearer token, and leaves health checks open', async () => {
    const app = server({ authToken: 'secret' });
    const ok = await app.inject({
      method: 'POST',
      url: '/triage',
      headers: { authorization: 'Bearer secret' },
      payload: ticket('T-1002'),
    });
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    await app.close();

    expect(ok.statusCode).toBe(200);
    expect(health.statusCode).toBe(200);
  });
});
