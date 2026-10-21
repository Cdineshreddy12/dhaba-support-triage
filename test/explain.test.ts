import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { ReplayProvider } from '../src/llm/replay.js';
import { createLogger } from '../src/log.js';
import { loadConfig } from '../src/config.js';
import { deriveLedger } from '../src/domain/ledger.js';
import { CLAIM_TYPES, evaluateRefund, explainRefund } from '../src/domain/refund-policy.js';
import { ALL_TICKETS, ticket } from './helpers.js';

const app = buildServer({
  config: { ...loadConfig(), mode: 'replay', apiKey: null, confidenceFloor: 0.6 },
  provider: new ReplayProvider(),
  logger: createLogger('error'),
});

afterAll(async () => {
  await app.close();
});

describe('the trace cannot disagree with the gate', () => {
  it('whichever rule the trace says won is the one that actually decides', () => {
    // A debugging view that can describe a decision the gate would not make is
    // worse than none, because it is believed.
    for (const t of ALL_TICKETS) {
      const facts = deriveLedger(t);
      for (const claim of CLAIM_TYPES) {
        const winner = explainRefund(facts, claim).find((r) => r.matched);
        const actual = evaluateRefund(facts, claim);

        expect(winner?.rule_id, `${t.id}/${claim}`).toBe(actual.rule_id);
        expect(winner?.outcome?.amount_inr, `${t.id}/${claim}`).toBe(actual.amount_inr);
      }
    }
  });

  it('exactly one rule matches, always', () => {
    for (const t of ALL_TICKETS) {
      const facts = deriveLedger(t);
      for (const claim of CLAIM_TYPES) {
        const matched = explainRefund(facts, claim).filter((r) => r.matched);
        expect(matched, `${t.id}/${claim}`).toHaveLength(1);
      }
    }
  });
});

describe('POST /triage/explain', () => {
  it('shows the rule that was passed over, which is the part logs cannot carry', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/triage/explain?claim=duplicate_charge',
      payload: ticket('T-1009'),
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.decided_by).toBe('R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE');

    // The counterfactual: the rule that would have paid, and why it did not.
    const duplicateRule = body.rules.find((r: { rule_id: string }) => r.rule_id === 'R3_DUPLICATE_CONFIRMED');
    expect(duplicateRule.matched).toBe(false);
    expect(body.ledger.duplicate_capture).toBeNull();
    expect(body.ledger.uncaptured).toEqual([{ id: 'pay_I1', status: 'failed' }]);
  });

  it('calls no model, so it is free to run during an incident', async () => {
    const provider = new ReplayProvider();
    let called = 0;
    const counting = {
      mode: 'replay' as const,
      classify: async (...args: Parameters<typeof provider.classify>) => {
        called++;
        return provider.classify(...args);
      },
    };
    const local = buildServer({
      config: { ...loadConfig(), mode: 'replay', apiKey: null, confidenceFloor: 0.6 },
      provider: counting,
      logger: createLogger('error'),
    });

    await local.inject({ method: 'POST', url: '/triage/explain', payload: ticket('T-1006') });
    await local.close();

    expect(called).toBe(0);
  });

  it('rejects a malformed ticket', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/triage/explain',
      payload: { nope: true },
    });
    expect(response.statusCode).toBe(400);
  });
});
