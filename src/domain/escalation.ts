import { LedgerFacts } from './ledger.js';
import { Severity } from './triage.js';

/**
 * Escalations the LEDGER can demand, regardless of what the ticket says.
 *
 * The gap this closes: T-1007 is a cheerful feature request ("can you add
 * marathi language?") from a user whose renewal failed three weeks earlier.
 * The model reads the text correctly -- it IS a feature request, p3, no human
 * needed -- and the text is not the problem. The problem is in `purchases[]`:
 * this person believes they are a subscriber and stopped being one on 21 Aug.
 *
 * Before this, `flags.entitlement_lapsed` was computed, returned in the
 * response, and routed nowhere. A signal nothing acts on is worse than no
 * signal, because it reads as coverage.
 *
 * So escalations are derived from LedgerFacts on the same terms as refunds:
 * no ticket text, no model opinion. They can raise severity and demand a human.
 * They can never lower severity, and they never touch money.
 */

export const ESCALATION_CODES = [
  'ENTITLEMENT_LAPSED_SILENTLY',
  'PAYMENT_STUCK_UNCAPTURED',
  'CHARGED_AND_NEVER_OPENED',
] as const;
export type EscalationCode = (typeof ESCALATION_CODES)[number];

export interface Escalation {
  code: EscalationCode;
  /** The least urgent this ticket may be. Never used to make a ticket calmer. */
  severity_floor: Severity;
  requires_human: boolean;
}

/** p0 is most urgent. Lower index wins when raising. */
const SEVERITY_ORDER: readonly Severity[] = ['p0', 'p1', 'p2', 'p3'];

export function deriveEscalations(facts: LedgerFacts): Escalation[] {
  const escalations: Escalation[] = [];

  if (facts.entitlement_lapsed) {
    // They think they are paying. They are not. Nobody has told them, and the
    // ticket they wrote gives no reason for anyone to look.
    escalations.push({
      code: 'ENTITLEMENT_LAPSED_SILENTLY',
      severity_floor: 'p2',
      requires_human: true,
    });
  }

  if (facts.payment_pending) {
    // `payment_pending`, NOT `claimed_charge_is_uncaptured`. The latter is also
    // true for a `failed` attempt, and a failure is terminal -- nothing is
    // held, nobody needs to chase the provider. Using it here escalated every
    // lapsed subscription as a stuck payment and pushed T-1007 to p1.
    escalations.push({
      code: 'PAYMENT_STUCK_UNCAPTURED',
      severity_floor: 'p1',
      requires_human: true,
    });
  }

  if (facts.unused_since_last_capture && facts.captured_total_inr > 0) {
    // Money taken, app never opened since. Not necessarily wrong -- but it is
    // the shape of every billing complaint that turns out to be justified, and
    // it is worth a person's eyes before it becomes a chargeback.
    escalations.push({
      code: 'CHARGED_AND_NEVER_OPENED',
      severity_floor: 'p2',
      requires_human: false,
    });
  }

  return escalations;
}

/**
 * Applies escalation floors to the model's severity.
 *
 * One-directional on purpose. If the model called something p0 and the ledger
 * only justifies p2, the answer stays p0 -- the ledger knows about money, not
 * about a user threatening a regulator. Escalations add urgency; they never
 * remove it.
 */
export function applySeverityFloors(modelSeverity: Severity, escalations: Escalation[]): Severity {
  let index = SEVERITY_ORDER.indexOf(modelSeverity);
  for (const escalation of escalations) {
    index = Math.min(index, SEVERITY_ORDER.indexOf(escalation.severity_floor));
  }
  return SEVERITY_ORDER[index]!;
}
