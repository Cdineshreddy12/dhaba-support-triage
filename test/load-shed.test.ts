import { describe, expect, it } from 'vitest';
import { ReplayProvider } from '../src/llm/replay.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { LoadShedder } from '../src/service/load-shedder.js';
import { TriageService } from '../src/service/triage-service.js';
import { ALL_TICKETS, CountingProvider, recordingLogger, ticket } from './helpers.js';

/**
 * The README's degradation ladder starts with "shed the model, never the gate".
 * These assert that claim rather than describing it.
 */
function build(limit: number) {
  const { logger, lines } = recordingLogger();
  const provider = new CountingProvider(new ReplayProvider());
  const service = new TriageService({
    provider,
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: 0.6,
    shedder: new LoadShedder(limit),
  });
  return { service, provider, lines };
}

describe('under load the model is dropped and the rules are not', () => {
  it('a shed request costs no model call', async () => {
    const { service, provider } = build(0);
    const result = await service.triage(ticket('T-1006'), 'req-shed');

    expect(provider.calls).toBe(0);
    expect(result.meta.model_attempts).toBe(0);
    expect(result.meta.degraded).toBe('load_shed');
    expect(result.meta.mode).toBe('rules_only');
  });

  it('the money decision still comes from the ledger', async () => {
    // The point of the whole arrangement: the expensive half is optional and
    // the half that moves money is not.
    const { service } = build(0);
    const result = await service.triage(ticket('T-1009'), 'req-shed-money');

    // T-1009 claims a double charge. Shed or not, there is one capture.
    expect(result.refund.rule_id).toBe('R8_DEFAULT_NO_CLAIM');
    expect(result.refund.amount_inr).toBe(0);
  });

  it('nothing auto-sends while shedding', async () => {
    const { service } = build(0);
    for (const t of ALL_TICKETS) {
      const result = await service.triage(t, `req-${t.id}`);
      expect(result.needs_human, `${t.id} would have sent unreviewed`).toBe(true);
    }
  });

  it('shedding never produces a payout, on any ticket', async () => {
    const { service } = build(0);
    for (const t of ALL_TICKETS) {
      const result = await service.triage(t, `req-pay-${t.id}`);
      expect(result.refund.decision, `${t.id}`).not.toBe('refund');
      expect(result.refund.amount_inr, `${t.id}`).toBe(0);
    }
  });

  it('a generous limit sheds nothing', async () => {
    const { service, provider } = build(64);
    const result = await service.triage(ticket('T-1006'), 'req-normal');

    expect(provider.calls).toBe(1);
    expect(result.meta.degraded).toBe('none');
    expect(result.refund.decision).toBe('refund');
  });

  it('the shed is logged with its reason and no ticket text', async () => {
    const { service, lines } = build(0);
    await service.triage(ticket('T-1010'), 'req-log');

    const shed = lines.find((l) => l.msg === 'shed the model call');
    expect(shed?.ctx.degraded).toBe('load_shed');
    // T-1010 carries a GSTIN and a company name in its body.
    expect(JSON.stringify(lines)).not.toContain('29ABCDE1234F1Z5');
  });
});
