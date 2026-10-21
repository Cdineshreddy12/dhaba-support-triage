import { describe, expect, it } from 'vitest';
import { deriveLedger } from '../src/domain/ledger.js';
import { applySeverityFloors, deriveEscalations } from '../src/domain/escalation.js';
import { evaluateRefund, CLAIM_TYPES } from '../src/domain/refund-policy.js';
import { ReplayProvider } from '../src/llm/replay.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { TriageService } from '../src/service/triage-service.js';
import { ALL_TICKETS, recordingLogger, ticket } from './helpers.js';

function service() {
  const { logger } = recordingLogger();
  return new TriageService({
    provider: new ReplayProvider(),
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: 0.55,
  });
}

describe('T-1007: the ledger escalates a ticket whose text gives no reason to look', () => {
  // The bug this closes. The model reads "can you add marathi language?"
  // correctly as a p3 feature request needing nobody. pay_G4 failed on 21 Aug,
  // so this user believes they are a subscriber and has not been one for weeks.
  it('is escalated even though the model said p3 and needs_human false', async () => {
    const result = await service().triage(ticket('T-1007'), 'req-7');

    expect(result.category).toBe('feature_request'); // the model was not wrong
    expect(result.escalations.map((e) => e.code)).toContain('ENTITLEMENT_LAPSED_SILENTLY');
    expect(result.needs_human).toBe(true);
    expect(result.severity).toBe('p2');
  });

  it('the escalation does not touch the refund decision', async () => {
    const result = await service().triage(ticket('T-1007'), 'req-7b');
    expect(result.refund.decision).toBe('none');
    expect(result.refund.amount_inr).toBe(0);
  });
});

describe('severity floors only ever raise urgency', () => {
  it('a p0 from the model survives a p2 floor', () => {
    const escalations = [
      { code: 'ENTITLEMENT_LAPSED_SILENTLY' as const, severity_floor: 'p2' as const, requires_human: true },
    ];
    expect(applySeverityFloors('p0', escalations)).toBe('p0');
  });

  it('a p3 from the model is raised to the floor', () => {
    const escalations = [
      { code: 'PAYMENT_STUCK_UNCAPTURED' as const, severity_floor: 'p1' as const, requires_human: true },
    ];
    expect(applySeverityFloors('p3', escalations)).toBe('p1');
  });

  it('the most urgent floor wins when several apply', () => {
    const escalations = [
      { code: 'CHARGED_AND_NEVER_OPENED' as const, severity_floor: 'p2' as const, requires_human: false },
      { code: 'PAYMENT_STUCK_UNCAPTURED' as const, severity_floor: 'p1' as const, requires_human: true },
    ];
    expect(applySeverityFloors('p3', escalations)).toBe('p1');
  });

  it('no escalation on any real ticket ever makes it less urgent', async () => {
    // The invariant. A floor that could lower severity would let a ledger
    // signal quietly de-prioritise a ticket a human flagged as urgent.
    for (const t of ALL_TICKETS) {
      const escalations = deriveEscalations(deriveLedger(t));
      const order = ['p0', 'p1', 'p2', 'p3'] as const;
      for (const from of order) {
        const to = applySeverityFloors(from, escalations);
        expect(order.indexOf(to), `${t.id} ${from} -> ${to}`).toBeLessThanOrEqual(order.indexOf(from));
      }
    }
  });
});

describe('escalations are ledger-derived, like refunds', () => {
  it('no claim type changes which escalations fire', () => {
    // Escalations read LedgerFacts only. If a ClaimType could move them, a
    // crafted ticket could suppress one -- e.g. hide a lapsed subscription.
    for (const t of ALL_TICKETS) {
      const facts = deriveLedger(t);
      const baseline = JSON.stringify(deriveEscalations(facts));
      for (const claim of CLAIM_TYPES) {
        // evaluateRefund is the only consumer of claim; escalations must not vary.
        evaluateRefund(facts, claim);
        expect(JSON.stringify(deriveEscalations(facts)), `${t.id}/${claim}`).toBe(baseline);
      }
    }
  });

  it('T-1005 escalates the stuck payment to p1 and a human', async () => {
    const result = await service().triage(ticket('T-1005'), 'req-5');
    expect(result.escalations.map((e) => e.code)).toContain('PAYMENT_STUCK_UNCAPTURED');
    expect(result.severity).toBe('p1');
    expect(result.needs_human).toBe(true);
  });

  it('a healthy paying user with no ledger signal gets no escalation', async () => {
    // T-1002: four successful renewals, 41 app opens. Nothing for the ledger
    // to say. Guards against escalations firing on everything, which would
    // make them meaningless.
    const result = await service().triage(ticket('T-1002'), 'req-2');
    expect(result.escalations).toEqual([]);
    expect(result.needs_human).toBe(false);
  });
});

describe('escalation codes are safe to log', () => {
  it('codes are a closed enum containing no ticket text', async () => {
    const result = await service().triage(ticket('T-1007'), 'req-7c');
    for (const escalation of result.escalations) {
      expect(escalation.code).toMatch(/^[A-Z_]+$/);
    }
  });
});
