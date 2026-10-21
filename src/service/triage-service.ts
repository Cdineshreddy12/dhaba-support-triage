import { Ticket } from '../domain/ticket.js';
import { deriveLedger, LedgerFacts } from '../domain/ledger.js';
import { evaluateRefund, RefundOutcome } from '../domain/refund-policy.js';
import { Degradation, ModelVerdict, TriageResponse } from '../domain/triage.js';
import { ModelProvider } from '../llm/provider.js';
import { redactLedger } from '../llm/prompt.js';
import { assembleReply } from './reply.js';
import { IdempotencyGuard } from './idempotency.js';
import { Logger } from '../log.js';

export interface TriageServiceOptions {
  provider: ModelProvider;
  guard: IdempotencyGuard;
  logger: Logger;
  /** Below this, the answer routes to a human instead of being acted on. */
  confidenceFloor: number;
  /** Stamped into responses. Injected so tests are deterministic. */
  now?: () => Date;
}

export class TriageService {
  constructor(private readonly opts: TriageServiceOptions) {}

  async triage(ticket: Ticket, requestId: string): Promise<TriageResponse> {
    const log = this.opts.logger.child({ request_id: requestId, ticket_id: ticket.id });

    const { decision, replayed } = await this.opts.guard.once(ticket.id, () =>
      this.decide(ticket, log),
    );

    if (replayed) {
      log.info('returned stored decision', {
        idempotent_replay: true,
        refund_decision: decision.refund.decision,
        refund_amount_inr: decision.refund.amount_inr,
        rule_id: decision.refund.rule_id,
      });
      return { ...decision, meta: { ...decision.meta, idempotent_replay: true } };
    }
    return decision;
  }

  private async decide(ticket: Ticket, log: Logger): Promise<TriageResponse> {
    const facts = deriveLedger(ticket);
    const { verdict, degraded, attempts } = await this.classify(ticket, facts, log);

    // The gate runs identically whether the model worked or not. When it did
    // not, claim_type is 'no_billing_claim', so a degraded request can never
    // produce a payout -- it produces a human.
    const refund: RefundOutcome = evaluateRefund(facts, verdict.claim_type);

    const lowConfidence = verdict.confidence < this.opts.confidenceFloor;
    const needsHuman =
      verdict.needs_human ||
      refund.requires_human ||
      lowConfidence ||
      verdict.prompt_injection_suspected ||
      degraded !== 'none';

    const response: TriageResponse = {
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
      needs_human: needsHuman,
      confidence: verdict.confidence,
      summary: verdict.summary,
      flags: {
        prompt_injection_suspected: verdict.prompt_injection_suspected,
        entitlement_lapsed: facts.entitlement_lapsed,
        claimed_charge_never_captured: facts.claimed_charge_is_uncaptured,
      },
      meta: {
        mode: degraded === 'none' ? (this.opts.provider.mode as 'live' | 'replay') : 'rules_only',
        degraded,
        model_attempts: attempts,
        idempotent_replay: false,
        decided_at: (this.opts.now?.() ?? new Date()).toISOString(),
      },
    };

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

    return response;
  }

  /**
   * Parse, retry once with the error fed back, then degrade.
   *
   * One retry rather than a loop: a model that returned unusable output twice
   * will return it a third time, and a ticket has a latency budget. The second
   * attempt exists because schema violations are often a near-miss the model
   * can fix when shown the issue path.
   */
  private async classify(
    ticket: Ticket,
    facts: LedgerFacts,
    log: Logger,
  ): Promise<{ verdict: ModelVerdict; degraded: Degradation; attempts: number }> {
    const ledger = redactLedger(facts);

    const first = await this.opts.provider.classify({ ticket, ledger });
    if (first.ok) return { verdict: first.verdict, degraded: 'none', attempts: 1 };

    log.warn('model attempt rejected', { failure: first.failure, validation_issues: first.detail });

    // Only a schema failure is worth retrying. An outage or a timeout will not
    // be fixed by asking again inside the same request.
    if (first.failure !== 'invalid_output') {
      return {
        verdict: fallbackVerdict(),
        degraded: first.failure === 'timeout' ? 'model_timeout' : 'model_unavailable',
        attempts: 1,
      };
    }

    const second = await this.opts.provider.classify({ ticket, ledger, correction: first.detail });
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
}

/**
 * What we return when there is no usable model output.
 *
 * Deliberately inert: claim_type 'no_billing_claim' means the gate has nothing
 * to act on, so no degraded request can move money. Confidence is 0 and a human
 * is required -- the caller is told plainly that nothing here was classified.
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
