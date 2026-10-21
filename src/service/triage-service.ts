import { Ticket } from '../domain/ticket.js';
import { deriveLedger, LedgerFacts } from '../domain/ledger.js';
import { evaluateRefund, RefundOutcome } from '../domain/refund-policy.js';
import { applySeverityFloors, deriveEscalations, Escalation } from '../domain/escalation.js';
import { Degradation, ModelVerdict, TriageResponse } from '../domain/triage.js';
import { ModelProvider } from '../llm/provider.js';
import { assembleReply } from './reply.js';
import { IdempotencyGuard } from './idempotency.js';
import { Logger } from '../log.js';

export interface TriageServiceOptions {
  provider: ModelProvider;
  guard: IdempotencyGuard;
  logger: Logger;
  /** Below this, the answer routes to a human instead of being acted on. */
  confidenceFloor: number;
  /** Injected so tests are deterministic. */
  now?: () => Date;
}

/** At or below this many words, a ticket cannot carry an unambiguous intent. */
const MIN_WORDS_TO_CLASSIFY = 3;

interface Classification {
  verdict: ModelVerdict;
  degraded: Degradation;
  attempts: number;
}

export class TriageService {
  constructor(private readonly opts: TriageServiceOptions) {}

  async triage(ticket: Ticket, requestId: string): Promise<TriageResponse> {
    const log = this.opts.logger.child({ request_id: requestId, ticket_id: ticket.id });

    const { decision, replayed } = await this.opts.guard.once(ticket.id, () =>
      this.decide(ticket, log),
    );

    if (!replayed) return decision;

    log.info('returned stored decision', {
      idempotent_replay: true,
      refund_decision: decision.refund.decision,
      refund_amount_inr: decision.refund.amount_inr,
      rule_id: decision.refund.rule_id,
    });
    return { ...decision, meta: { ...decision.meta, idempotent_replay: true } };
  }

  private async decide(ticket: Ticket, log: Logger): Promise<TriageResponse> {
    const facts = deriveLedger(ticket);
    const classification = await this.classify(ticket, facts, log);

    // The gate runs identically whether the model worked or not. When it did
    // not, claim_type is 'no_billing_claim', so degrading produces a human
    // rather than a payout.
    const refund = evaluateRefund(facts, classification.verdict.claim_type);
    const escalations = deriveEscalations(facts);

    const response = this.buildResponse(ticket, facts, classification, refund, escalations);
    this.logDecision(log, response, classification, refund, facts, escalations);
    return response;
  }

  private buildResponse(
    ticket: Ticket,
    facts: LedgerFacts,
    { verdict, degraded, attempts }: Classification,
    refund: RefundOutcome,
    escalations: Escalation[],
  ): TriageResponse {
    return {
      ticket_id: ticket.id,
      category: verdict.category,
      severity: applySeverityFloors(verdict.severity, escalations),
      claim_type: verdict.claim_type,
      refund: {
        decision: refund.decision,
        amount_inr: refund.amount_inr,
        currency: 'INR',
        reason: refund.reason,
        rule_id: refund.rule_id,
        requires_human: refund.requires_human,
        basis: refund.basis,
      },
      reply_draft: assembleReply(verdict.reply_body, refund, verdict.language),
      language: verdict.language,
      needs_human: this.needsHuman(ticket, verdict, refund, escalations, degraded),
      confidence: verdict.confidence,
      summary: verdict.summary,
      flags: {
        prompt_injection_suspected: verdict.prompt_injection_suspected,
        entitlement_lapsed: facts.entitlement_lapsed,
        claimed_charge_never_captured: facts.claimed_charge_is_uncaptured,
      },
      escalations,
      meta: {
        mode: degraded === 'none' ? this.opts.provider.mode : 'rules_only',
        degraded,
        model_attempts: attempts,
        idempotent_replay: false,
        decided_at: (this.opts.now?.() ?? new Date()).toISOString(),
      },
    };
  }

  /**
   * Any one of these is enough. Unsure always means a person, never a guess.
   *
   * The first condition is the one that does not depend on a model. Swapping
   * claude-opus-5 for claude-sonnet-5 changed `verdict.needs_human` on T-1012
   * -- the "refund me or I leave 1 star" ticket -- from true to false, which
   * would have auto-paid a coercion attempt with nobody reading it. Whether
   * money leaving the account deserves review is not a judgement to delegate
   * to whichever model is configured this week.
   */
  private needsHuman(
    ticket: Ticket,
    verdict: ModelVerdict,
    refund: RefundOutcome,
    escalations: Escalation[],
    degraded: Degradation,
  ): boolean {
    return (
      refund.decision === 'refund' ||
      tooShortToBeSure(ticket) ||
      verdict.needs_human ||
      refund.requires_human ||
      verdict.confidence < this.opts.confidenceFloor ||
      verdict.prompt_injection_suspected ||
      escalations.some((e) => e.requires_human) ||
      degraded !== 'none'
    );
  }

  /**
   * Parse, retry once with the error fed back, then degrade.
   *
   * One retry rather than a loop: a model that returned unusable output twice
   * will do it again, and a ticket has a latency budget.
   */
  private async classify(ticket: Ticket, facts: LedgerFacts, log: Logger): Promise<Classification> {
    const first = await this.opts.provider.classify({ ticket, facts });
    if (first.ok) return { verdict: first.verdict, degraded: 'none', attempts: 1 };

    log.warn('model attempt rejected', { failure: first.failure, validation_issues: first.detail });

    // An outage or timeout will not be fixed by asking again in the same request.
    if (first.failure !== 'invalid_output') {
      return {
        verdict: fallbackVerdict(),
        degraded: first.failure === 'timeout' ? 'model_timeout' : 'model_unavailable',
        attempts: 1,
      };
    }

    const second = await this.opts.provider.classify({ ticket, facts, correction: first.detail });
    if (second.ok) {
      log.info('model recovered on retry', { model_attempts: 2 });
      return { verdict: second.verdict, degraded: 'none', attempts: 2 };
    }

    log.error('model unusable after retry, falling back to rules', {
      failure: second.failure,
      validation_issues: second.detail,
    });
    return { verdict: fallbackVerdict(), degraded: 'model_output_invalid', attempts: 2 };
  }

  private logDecision(
    log: Logger,
    response: TriageResponse,
    { verdict, degraded, attempts }: Classification,
    refund: RefundOutcome,
    facts: LedgerFacts,
    escalations: Escalation[],
  ): void {
    log.info('triage decided', {
      ...(escalations.length > 0 && { escalations: escalations.map((e) => e.code).join(',') }),
      mode: response.meta.mode,
      degraded,
      model_attempts: attempts,
      category: response.category,
      severity: response.severity,
      claim_type: verdict.claim_type,
      language: response.language,
      confidence: response.confidence,
      needs_human: response.needs_human,
      prompt_injection_suspected: verdict.prompt_injection_suspected,
      refund_decision: refund.decision,
      refund_amount_inr: refund.amount_inr,
      refund_reason: refund.reason,
      rule_id: refund.rule_id,
      captured_count: facts.captured_count,
      captured_total_inr: facts.captured_total_inr,
    });
  }
}


/**
 * A ticket too short to carry an intent. T-1004's entire body is "cancel":
 * cancel the subscription, cancel the trial before it converts, or cancel this
 * support request? Three different outcomes.
 *
 * This is deliberately a property of the input, not of the model's confidence.
 * I first tried catching T-1004 by tuning the floor -- it came back 0.55, so I
 * set the floor to 0.6; the next recording came back 0.60 and it slipped again.
 * Confidence on a genuinely ambiguous ticket wobbles across the threshold you
 * pick, so the threshold is the wrong instrument. Word count does not wobble.
 *
 * It can only ever add a human, never move money, which is why reading the body
 * here does not breach the ledger/text separation.
 */
function tooShortToBeSure(ticket: Ticket): boolean {
  return ticket.body.trim().split(/\s+/).filter(Boolean).length <= MIN_WORDS_TO_CLASSIFY;
}

/**
 * Returned when there is no usable model output. Inert on purpose:
 * claim_type 'no_billing_claim' gives the gate nothing to act on.
 */
export function fallbackVerdict(): ModelVerdict {
  return {
    category: 'other',
    severity: 'p1',
    claim_type: 'no_billing_claim',
    language: 'en',
    reply_body:
      'Thanks for writing in. We have your message and a member of our team is picking this up directly.',
    needs_human: true,
    confidence: 0,
    prompt_injection_suspected: false,
    summary: 'Automatic classification unavailable; routed to a human unread.',
  };
}
