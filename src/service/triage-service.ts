import { Ticket } from '../domain/ticket.js';
import { deriveLedger, LedgerFacts } from '../domain/ledger.js';
import { evaluateRefund, RefundOutcome } from '../domain/refund-policy.js';
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

    const response = this.buildResponse(ticket, facts, classification, refund);
    this.logDecision(log, response, classification, refund, facts);
    return response;
  }

  private buildResponse(
    ticket: Ticket,
    facts: LedgerFacts,
    { verdict, degraded, attempts }: Classification,
    refund: RefundOutcome,
  ): TriageResponse {
    return {
      ticket_id: ticket.id,
      category: verdict.category,
      severity: verdict.severity,
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
      needs_human: this.needsHuman(verdict, refund, degraded),
      confidence: verdict.confidence,
      summary: verdict.summary,
      flags: {
        prompt_injection_suspected: verdict.prompt_injection_suspected,
        entitlement_lapsed: facts.entitlement_lapsed,
        claimed_charge_never_captured: facts.claimed_charge_is_uncaptured,
      },
      meta: {
        mode: degraded === 'none' ? this.opts.provider.mode : 'rules_only',
        degraded,
        model_attempts: attempts,
        idempotent_replay: false,
        decided_at: (this.opts.now?.() ?? new Date()).toISOString(),
      },
    };
  }

  /** Any one of these is enough. Unsure always means a person, never a guess. */
  private needsHuman(
    verdict: ModelVerdict,
    refund: RefundOutcome,
    degraded: Degradation,
  ): boolean {
    return (
      verdict.needs_human ||
      refund.requires_human ||
      verdict.confidence < this.opts.confidenceFloor ||
      verdict.prompt_injection_suspected ||
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
  ): void {
    log.info('triage decided', {
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
