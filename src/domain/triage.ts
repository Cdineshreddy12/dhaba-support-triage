import { z } from 'zod';
import { CLAIM_TYPES, REFUND_REASONS } from './refund-policy.js';

/**
 * Categories. Small and closed on purpose: the model picks from this list or
 * its output is rejected. An invented category is a validation failure, not a
 * new category.
 */
export const Category = z.enum([
  'billing_refund_request',
  'billing_payment_not_activated',
  'billing_duplicate_charge_claim',
  'billing_unauthorized_charge',
  'billing_invoice_request',
  'subscription_cancellation',
  'technical_bug',
  'feature_request',
  'account_recovery',
  'pre_sales_question',
  'other',
]);
export type Category = z.infer<typeof Category>;

/**
 * Severity. Defined by response obligation, not by how upset the text sounds,
 * so that an angry feature request does not outrank a silent fraud report.
 *
 * p0 money moved wrongly, or a legal/regulatory threat. Minutes.
 * p1 user is blocked from a thing they have paid for. Same day.
 * p2 real problem, workaround exists or no money at stake. Two days.
 * p3 no obligation: requests, opinions, questions. Best effort.
 */
export const Severity = z.enum(['p0', 'p1', 'p2', 'p3']);
export type Severity = z.infer<typeof Severity>;

/** Reply in the language the user wrote in. `hinglish` is romanised Hindi (T-1005). */
export const Language = z.enum(['en', 'hi', 'hinglish', 'other']);
export type Language = z.infer<typeof Language>;

/**
 * What the model is allowed to return. Note what is absent: any amount, any
 * currency, any decision to pay. The widest claim the model can make about
 * money is a ClaimType, which the gate is free to disagree with.
 */
export const ModelVerdict = z.object({
  category: Category,
  severity: Severity,
  claim_type: z.enum(CLAIM_TYPES),
  language: Language,
  /** Empathy and explanation ONLY. Must not assert a refund outcome. */
  reply_body: z.string().min(1).max(1200),
  needs_human: z.boolean(),
  confidence: z.number().min(0).max(1),
  /** Set when the ticket contains text addressed to the assistant rather than to support. */
  prompt_injection_suspected: z.boolean(),
  /** One line, for a human skimming a queue. */
  summary: z.string().min(1).max(240),
});
export type ModelVerdict = z.infer<typeof ModelVerdict>;

export const RefundResult = z.object({
  decision: z.enum(['none', 'refund', 'hold_for_human']),
  amount_inr: z.number().nonnegative(),
  currency: z.literal('INR'),
  reason: z.enum(REFUND_REASONS),
  rule_id: z.string(),
  requires_human: z.boolean(),
  basis: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type RefundResult = z.infer<typeof RefundResult>;

/** Why a response is not fully model-derived. Visible to the caller, never silent. */
export const Degradation = z.enum([
  'none',
  'model_output_invalid',
  'model_unavailable',
  'model_timeout',
  'load_shed',
]);
export type Degradation = z.infer<typeof Degradation>;

export const TriageResponse = z.object({
  ticket_id: z.string(),
  category: Category,
  severity: Severity,
  refund: RefundResult,
  reply_draft: z.string().min(1),
  language: Language,
  needs_human: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  flags: z.object({
    prompt_injection_suspected: z.boolean(),
    entitlement_lapsed: z.boolean(),
    claimed_charge_never_captured: z.boolean(),
  }),
  meta: z.object({
    mode: z.enum(['live', 'replay', 'rules_only']),
    degraded: Degradation,
    model_attempts: z.number().int().nonnegative(),
    /** True when this exact ticket_id was decided before and the stored decision was returned. */
    idempotent_replay: z.boolean(),
    decided_at: z.string(),
  }),
});
export type TriageResponse = z.infer<typeof TriageResponse>;
