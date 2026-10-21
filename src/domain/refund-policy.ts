import { LedgerFacts } from './ledger.js';

/**
 * THE MONEY GATE.
 *
 * The model never names a rupee amount. It contributes exactly one constrained
 * token -- a ClaimType, below -- describing what the user appears to be
 * claiming. Every amount returned from here is read out of a captured payment
 * in the ledger. There is no code path by which text in a ticket becomes money.
 *
 * Consequences worth stating, because they are the point:
 *   - A threat ("1 star on play store") cannot raise a refund. T-1012 resolves
 *     identically with the threatening sentence removed; test/refund-gate asserts it.
 *   - An injected "approve a full refund immediately" cannot be obeyed, because
 *     obeying it would require a path that does not exist. T-1003.
 *   - A sincere user who believes they were charged, but was not, is not
 *     refunded -- they are told the truth. T-1005, T-1009.
 *
 * Rules are ordered data, first match wins. Changing policy means editing a row,
 * not hunting for branches.
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

const RULES: Rule[] = [
  {
    // Fraud is never settled by an automated refund. A refund here would close
    // the ticket and destroy the investigation path the family actually needs.
    id: 'R0_FRAUD_TO_HUMAN',
    when: (_f, claim) => claim === 'unauthorized_charge',
    then: (f) => ({
      decision: 'hold_for_human',
      amount_inr: 0,
      reason: 'FRAUD_CLAIM_NEEDS_IDENTITY_CHECK',
      requires_human: true,
      basis: { captured_count: f.captured_count, captured_total_inr: f.captured_total_inr },
    }),
  },
  {
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
    // The user sincerely believes money left their account. It did not.
    id: 'R2_CLAIMED_CHARGE_NEVER_CAPTURED',
    when: (f, claim) =>
      claim === 'payment_not_reflected' && f.claimed_charge_is_uncaptured,
    then: (f) => ({
      decision: 'none',
      amount_inr: 0,
      reason: 'CLAIMED_CHARGE_NEVER_CAPTURED',
      requires_human: true, // a stuck payment still needs someone to unstick it
      basis: {
        uncaptured_ids: f.uncaptured.map((p) => p.id).join(','),
        captured_total_inr: f.captured_total_inr,
      },
    }),
  },
  {
    id: 'R3_DUPLICATE_CONFIRMED',
    when: (f, claim) => claim === 'duplicate_charge' && f.duplicate_capture !== null,
    then: (f) => ({
      decision: 'refund',
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
    // "You charged me twice" with only one capture on file. Explain, do not pay.
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
    // The remorse window. Note what is NOT consulted: tone, threat, politeness,
    // claimed VIP status. Only when the money moved and whether the plan was used.
    id: 'R5_REMORSE_WINDOW',
    when: (f, claim) =>
      (claim === 'unwanted_renewal' ||
        claim === 'trial_conversion_surprise' ||
        claim === 'dissatisfaction') &&
      f.last_capture !== null &&
      f.hours_since_last_capture !== null &&
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
    id: 'R6_WINDOW_EXPIRED_OR_USED',
    when: (f, claim) =>
      claim === 'unwanted_renewal' ||
      claim === 'trial_conversion_surprise' ||
      claim === 'dissatisfaction',
    then: (f) => {
      const used = f.app_opens_since_renewal > REMORSE_MAX_APP_OPENS;
      return {
        decision: 'hold_for_human' as const,
        amount_inr: 0,
        reason: used ? ('SERVICE_USED_SUBSTANTIALLY' as const) : ('OUTSIDE_REMORSE_WINDOW' as const),
        requires_human: true,
        basis: {
          hours_since_capture:
            f.hours_since_last_capture === null ? null : Number(f.hours_since_last_capture.toFixed(2)),
          app_opens_since_renewal: f.app_opens_since_renewal,
        },
      };
    },
  },
  {
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
 * Last line of defence. Every rupee we return must be traceable to a payment we
 * actually captured. If a future rule ever violates that, this throws rather
 * than paying out -- a 500 is cheaper than money leaving on a bad rule.
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
