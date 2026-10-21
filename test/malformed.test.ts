import { describe, expect, it } from 'vitest';
import { ReplayProvider } from '../src/llm/replay.js';
import { deriveLedger } from '../src/domain/ledger.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { TriageService } from '../src/service/triage-service.js';
import { recordingLogger, syntheticTicket, ticket } from './helpers.js';

/**
 * The brief names three shapes of bad model output: prose, truncated json, and
 * an invented category. Each needs the degrade path to be real, so each gets a
 * recording and a test.
 */
const FIXTURES = 'test/fixtures/replay';

function service(provider: ReplayProvider) {
  const { logger } = recordingLogger();
  return new TriageService({
    provider,
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: 0.6,
  });
}

describe('bad model output never escapes the provider as an exception', () => {
  it.each([
    ['prose instead of json', 'T-9003'],
    ['truncated json', 'T-9004'],
    ['an invented category', 'T-9001'],
  ])('%s is reported as a failure, not thrown', async (_label, id) => {
    const provider = new ReplayProvider(FIXTURES);
    const t = syntheticTicket(id);
    const result = await provider.classify({ ticket: t, facts: deriveLedger(t) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('invalid_output');
  });
});

describe('each shape degrades to a usable response', () => {
  it.each([
    ['prose', 'T-9003'],
    ['truncated json', 'T-9004'],
  ])('%s degrades rather than 500ing', async (_label, id) => {
    const result = await service(new ReplayProvider(FIXTURES)).triage(
      syntheticTicket(id),
      `req-${id}`,
    );

    expect(result.meta.degraded).toBe('model_output_invalid');
    expect(result.meta.mode).toBe('rules_only');
    expect(result.needs_human).toBe(true);
    expect(result.refund.amount_inr).toBe(0);
    expect(result.reply_draft.length).toBeGreaterThan(0);
  });

  it('a real refundable ticket still gets its money decision from the rules', async () => {
    // The point of degrading rather than failing: the ledger half still works.
    const broken = { ...ticket('T-1006'), id: 'T-9003' };
    const result = await service(new ReplayProvider(FIXTURES)).triage(broken, 'req-money');

    expect(result.meta.degraded).toBe('model_output_invalid');
    expect(result.refund.rule_id).toBeTruthy();
  });
});
