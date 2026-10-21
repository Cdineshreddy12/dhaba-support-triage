import { LedgerFacts } from './ledger.js';

/**
 * The money gate.
 *
 * The model contributes one constrained token -- a ClaimType -- describing what
 * the user appears to claim. Every amount is read out of a captured payment.
 * There is no code path by which ticket text becomes money, which is why a
 * threat (T-1012) and an injected refund demand (T-1003) both change nothing.
 *
 * Rules are ordered data, first match wins. Policy changes are row edits.
 */

/** The ONLY thing the model is permitted to contribute to a money decision. */
export const CLAIM_TYPES = [
  'unauthorized_charge',
  'duplicate_charge',
  'payment_not_reflected',
  'unwanted_renewal',
  'trial_conversion_surprise',
  'dissatisfaction',
  'cancellation',
  'no_billing_claim',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export type RefundDecision = 'none' | 'refund' | 'hold_for_human';

export const REFUND_REASONS = [
  'FRAUD_CLAIM_NEEDS_IDENTITY_CHECK',
  'NO_CAPTURED_PAYMENT',
  'CLAIMED_CHARGE_NEVER_CAPTURED',
  'NOT_A_DUPLICATE_ONE_CAPTURE_ONLY',
  'DUPLICATE_CAPTURE_CONFIRMED',
  'REMORSE_WINDOW_UNUSED',
  'OUTSIDE_REMORSE_WINDOW',
  'SERVICE_USED_SUBSTANTIALLY',
  'CANCELLATION_NO_REFUND_DUE',
  'NO_BILLING_CLAIM',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export interface RefundOutcome {
  decision: RefundDecision;
  amount_inr: number;
  reason: RefundReason;
  /** Which rule fired. Goes in the logs so a 3am reader knows why money moved. */
  rule_id: string;
  requires_human: boolean;
  /** Facts the rule relied on. Ids and numbers only -- never ticket text. */
  basis: Record<string, string | number | boolean | null>;
}

/** How long after a capture we will reverse it on request alone. */
const REMORSE_WINDOW_HOURS = 72;
/** Above this many opens since the charge, the plan was actually used. */
const REMORSE_MAX_APP_OPENS = 3;

interface Rule {
  id: string;
  when: (f: LedgerFacts, claim: ClaimType) => boolean;
  then: (f: LedgerFacts) => Omit<RefundOutcome, 'rule_id'>;
}

/**
 * The policy, as ordered data. First match wins.
 *
 * ORDER IS THE LOGIC, not formatting. R0 sits above R5 because an elder-fraud
 * report must reach a person even when the ledger would otherwise refund it;
 * R8 sits last because it must catch everything so evaluateRefund always
 * resolves. Moving a row changes policy.
 *
 * Every `when` reads only LedgerFacts and ClaimType. Every `amount_inr` is read
 * off a Purchase in facts.captured -- never a plan price, never a literal,
 * never arithmetic. `basis` records what the rule relied on, so a decision can
 * be explained later without re-reading the ticket.
 */
const RULES: Rule[] = [
  {
    // Never auto-refund fraud: paying out closes the ticket and destroys the
    // investigation path an elder-fraud report actually needs. (T-1008)
    id: 'R0_FRAUD_TO_HUMAN',
    when: (_f, claim) => claim === 'unauthorized_charge',
    then: (f) => ({
      decision: 'hold_for_human',
      amount_inr: 0,
      reason: 'FRAUD_CLAIM_NEEDS_IDENTITY_CHECK',
      requires_human: true,
      basis: {
        captured_count: f.captured_count,
        captured_total_inr: f.captured_total_inr,
      },
    }),
  },
  {
    // Nothing captured, nothing to return. (T-1011)
    id: 'R1_NOTHING_CAPTURED',
    when: (f) => f.captured_total_inr === 0,
    then: () => ({
      decision: 'none',
      amount_inr: 0,
      reason: 'NO_CAPTURED_PAYMENT',
      requires_human: false,
      basis: { captured_count: 0 },
    }),
  },
  {
    // Sincere user, but the latest attempt never captured. Pay nothing; a
    // person still has to unstick the payment. (T-1005)
    id: 'R2_CLAIMED_CHARGE_NEVER_CAPTURED',
    when: (f, claim) => claim === 'payment_not_reflected' && f.claimed_charge_is_uncaptured,
    then: (f) => ({
      decision: 'none',
      amount_inr: 0,
      reason: 'CLAIMED_CHARGE_NEVER_CAPTURED',
      // Nothing to refund, but a stuck payment still needs someone to unstick it.
      requires_human: true,
      basis: {
        uncaptured_ids: f.uncaptured.map((p) => p.id).join(','),
        captured_total_inr: f.captured_total_inr,
      },
    }),
  },
  {
    // Two captures of the same amount, close together. No fixture ticket hits
    // this -- the rule exists because the claim does.
    id: 'R3_DUPLICATE_CONFIRMED',
    when: (f, claim) => claim === 'duplicate_charge' && f.duplicate_capture !== null,
    then: (f) => ({
      decision: 'refund',
      // The second capture's own amount. Not a plan price, not doubled.
      amount_inr: f.duplicate_capture!.amount_inr,
      reason: 'DUPLICATE_CAPTURE_CONFIRMED',
      requires_human: false,
      basis: {
        original_id: f.duplicate_capture!.original_id,
        duplicate_id: f.duplicate_capture!.duplicate_id,
        hours_apart: f.duplicate_capture!.hours_apart,
      },
    }),
  },
  {
    // "Charged me twice" with one capture on file. Explain, do not pay. (T-1009)
    id: 'R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE',
    when: (f, claim) => claim === 'duplicate_charge' && f.duplicate_capture === null,
    then: (f) => ({
      decision: 'none',
      amount_inr: 0,
      reason: 'NOT_A_DUPLICATE_ONE_CAPTURE_ONLY',
      requires_human: false,
      basis: {
        captured_count: f.captured_count,
        failed_or_pending_ids: f.uncaptured.map((p) => p.id).join(','),
      },
    }),
  },
  {
    // Charged recently, barely used => money back. Reads only time, usage and
    // claim type. Not tone, not threats, not claimed VIP status.
    id: 'R5_REMORSE_WINDOW',
    when: (f, claim) =>
      (claim === 'unwanted_renewal' ||
        claim === 'trial_conversion_surprise' ||
        claim === 'dissatisfaction') &&
      f.last_capture !== null &&
      f.hours_since_last_capture !== null &&
      // Lower bound as well as upper. A capture timestamped after the ticket
      // gives a negative elapsed time, and `<= 72` is true for every negative
      // number -- so without this the window would open on charges that have
      // not happened yet.
      f.hours_since_last_capture >= 0 &&
      f.hours_since_last_capture <= REMORSE_WINDOW_HOURS &&
      f.app_opens_since_renewal <= REMORSE_MAX_APP_OPENS,
    then: (f) => ({
      decision: 'refund',
      amount_inr: f.last_capture!.amount_inr,
      reason: 'REMORSE_WINDOW_UNUSED',
      requires_human: false,
      basis: {
        capture_id: f.last_capture!.id,
        hours_since_capture: Number(f.hours_since_last_capture!.toFixed(2)),
        app_opens_since_renewal: f.app_opens_since_renewal,
      },
    }),
  },
  {
    // Same claims, but the window passed or the plan was genuinely used.
    id: 'R6_WINDOW_EXPIRED_OR_USED',
    when: (_f, claim) =>
      claim === 'unwanted_renewal' ||
      claim === 'trial_conversion_surprise' ||
      claim === 'dissatisfaction',
    then: (f) => {
      const used = f.app_opens_since_renewal > REMORSE_MAX_APP_OPENS;
      return {
        decision: 'hold_for_human' as const,
        amount_inr: 0,
        reason: used
          ? ('SERVICE_USED_SUBSTANTIALLY' as const)
          : ('OUTSIDE_REMORSE_WINDOW' as const),
        requires_human: true,
        basis: {
          hours_since_capture:
            f.hours_since_last_capture === null
              ? null
              : Number(f.hours_since_last_capture.toFixed(2)),
          app_opens_since_renewal: f.app_opens_since_renewal,
        },
      };
    },
  },
  {
    // Wants future charges stopped, not money back. (T-1004)
    id: 'R7_CANCELLATION',
    when: (_f, claim) => claim === 'cancellation',
    then: (f) => ({
      decision: 'none',
      amount_inr: 0,
      reason: 'CANCELLATION_NO_REFUND_DUE',
      requires_human: false,
      basis: { captured_total_inr: f.captured_total_inr },
    }),
  },
  {
    // Terminal. Must match everything so evaluateRefund always resolves.
    id: 'R8_DEFAULT_NO_CLAIM',
    when: () => true,
    then: () => ({
      decision: 'none',
      amount_inr: 0,
      reason: 'NO_BILLING_CLAIM',
      requires_human: false,
      basis: {},
    }),
  },
];

export function evaluateRefund(facts: LedgerFacts, claim: ClaimType): RefundOutcome {
  const rule = RULES.find((r) => r.when(facts, claim)) ?? RULES[RULES.length - 1]!;
  const outcome: RefundOutcome = { ...rule.then(facts), rule_id: rule.id };
  assertSpendable(outcome, facts);
  return outcome;
}

/**
 * Last line of defence: every rupee must trace to a payment we captured. Throws
 * rather than paying out, because a 500 is cheaper than a wrong refund.
 */
function assertSpendable(outcome: RefundOutcome, facts: LedgerFacts): void {
  if (outcome.amount_inr === 0) return;
  if (outcome.decision !== 'refund') {
    throw new Error(`refund gate: non-refund decision carried amount (${outcome.rule_id})`);
  }
  if (outcome.amount_inr < 0 || outcome.amount_inr > facts.captured_total_inr) {
    throw new Error(`refund gate: amount exceeds captured total (${outcome.rule_id})`);
  }
  if (!facts.captured.some((p) => p.amount_inr === outcome.amount_inr)) {
    throw new Error(`refund gate: amount matches no captured payment (${outcome.rule_id})`);
  }
}

export const POLICY_CONSTANTS = { REMORSE_WINDOW_HOURS, REMORSE_MAX_APP_OPENS } as const;
