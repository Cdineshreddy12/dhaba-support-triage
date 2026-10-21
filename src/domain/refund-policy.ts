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

/**
 * ============================================================================
 * TO BE WRITTEN BY HAND.
 *
 * Each entry below states what the rule must do, which tickets it governs, and
 * the test that pins it. Write `when` and `then`; the tests are the spec and
 * they are currently red.
 *
 * Reminders that are easy to get wrong:
 *   - ORDER IS THE LOGIC. First match wins. Safety rules go first.
 *   - `when` may read ONLY LedgerFacts and ClaimType. Never ticket text.
 *   - `amount_inr` must be read off a Purchase in facts.captured.
 *     Never a plan price, never a number from the ticket, never computed.
 *   - `basis` is the audit trail: the ids and numbers the rule relied on.
 *   - Run `npm test` after each rule; the invariant tests catch over-reach.
 * ============================================================================
 */
const RULES: Rule[] = [
  {
    // Fraud / unauthorised charge claims never auto-refund. A refund closes the
    // ticket and destroys the investigation path an elder-fraud report needs.
    // Governs: T-1008. Test: "T-1008 fraud is held for a human rather than auto-refunded"
    // Expect: decision hold_for_human, amount 0, requires_human true,
    //         reason FRAUD_CLAIM_NEEDS_IDENTITY_CHECK.
    id: 'R0_FRAUD_TO_HUMAN',
    when: () => TODO('R0_FRAUD_TO_HUMAN'),
    then: () => TODO('R0_FRAUD_TO_HUMAN'),
  },
  {
    // Nothing was ever captured on this account, so there is nothing to return.
    // Governs: T-1011 (no purchases at all).
    // Test: "T-1011 has no purchases, so every claim resolves to zero"
    // Expect: decision none, amount 0, reason NO_CAPTURED_PAYMENT.
    id: 'R1_NOTHING_CAPTURED',
    when: () => TODO('R1_NOTHING_CAPTURED'),
    then: () => TODO('R1_NOTHING_CAPTURED'),
  },
  {
    // The user sincerely believes money left their account; the ledger says the
    // latest attempt never captured. Pay nothing, but a human must unstick it.
    // Governs: T-1005 (pay_E2 is 'initiated').
    // Test: "T-1005 uncaptured payment pays nothing but still reaches a human"
    // Expect: decision none, amount 0, requires_human TRUE,
    //         reason CLAIMED_CHARGE_NEVER_CAPTURED. Put the uncaptured ids in basis.
    id: 'R2_CLAIMED_CHARGE_NEVER_CAPTURED',
    when: () => TODO('R2_CLAIMED_CHARGE_NEVER_CAPTURED'),
    then: () => TODO('R2_CLAIMED_CHARGE_NEVER_CAPTURED'),
  },
  {
    // A genuine double charge: two CAPTURES of the same amount close together.
    // No fixture ticket hits this -- the rule exists because the claim does.
    // Expect: decision refund, amount = the duplicate capture's amount.
    id: 'R3_DUPLICATE_CONFIRMED',
    when: () => TODO('R3_DUPLICATE_CONFIRMED'),
    then: () => TODO('R3_DUPLICATE_CONFIRMED'),
  },
  {
    // "You charged me twice" with only one capture on file. Explain, do not pay.
    // Governs: T-1009 (one failed + one successful = ONE charge).
    // Test: "T-1009 duplicate claim against a single capture pays nothing"
    // Expect: decision none, amount 0, reason NOT_A_DUPLICATE_ONE_CAPTURE_ONLY.
    id: 'R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE',
    when: () => TODO('R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE'),
    then: () => TODO('R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE'),
  },
  {
    // The remorse window. Charged recently, barely used => money back.
    // Consults ONLY: hours since capture, app opens, and the claim type.
    // NOT consulted: tone, threats, politeness, claimed VIP status.
    // Governs: T-1001 (trial conversion, 0 opens), T-1006 (annual, 0 opens),
    //          T-1012 (dissatisfaction, 2 opens -- the threatening one).
    // Tests: "T-1001 ... Rs 249 back", "T-1006 ... Rs 1499 back",
    //        "T-1012: the play-store threat does not change the outcome"
    // Use POLICY_CONSTANTS.REMORSE_WINDOW_HOURS and REMORSE_MAX_APP_OPENS.
    // Expect: decision refund, amount = facts.last_capture.amount_inr,
    //         reason REMORSE_WINDOW_UNUSED.
    id: 'R5_REMORSE_WINDOW',
    when: () => TODO('R5_REMORSE_WINDOW'),
    then: () => TODO('R5_REMORSE_WINDOW'),
  },
  {
    // Same claims as R5 but the window has passed or the plan was genuinely used.
    // Governs: T-1003 under any coerced claim type (last capture ~5 months old).
    // Test: "T-1003: no claim type an injection could force yields a payout"
    // Expect: decision hold_for_human, amount 0, requires_human true.
    //         reason SERVICE_USED_SUBSTANTIALLY if opens > max, else OUTSIDE_REMORSE_WINDOW.
    id: 'R6_WINDOW_EXPIRED_OR_USED',
    when: () => TODO('R6_WINDOW_EXPIRED_OR_USED'),
    then: () => TODO('R6_WINDOW_EXPIRED_OR_USED'),
  },
  {
    // Wants future charges stopped, is not asking for money back.
    // Governs: T-1004 ("cancel", one word).
    // Expect: decision none, amount 0, reason CANCELLATION_NO_REFUND_DUE.
    id: 'R7_CANCELLATION',
    when: () => TODO('R7_CANCELLATION'),
    then: () => TODO('R7_CANCELLATION'),
  },
  {
    // Terminal catch-all. Must match everything so evaluateRefund always resolves.
    // Governs: T-1002, T-1007, T-1010, and T-1003's no_billing_claim.
    // Expect: decision none, amount 0, reason NO_BILLING_CLAIM, empty basis.
    id: 'R8_DEFAULT_NO_CLAIM',
    when: () => TODO('R8_DEFAULT_NO_CLAIM'),
    then: () => TODO('R8_DEFAULT_NO_CLAIM'),
  },
];

/** Placeholder so the stub typechecks. Delete every call as you write the rules. */
function TODO(ruleId: string): never {
  throw new Error(`refund rule ${ruleId} is not written yet`);
}

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
