import { TriageResponse } from '../domain/triage.js';

/**
 * The numbers the README says it would watch, actually counted.
 *
 * Process-local and reset on restart. Real deployments scrape and aggregate
 * elsewhere; the point here is that `needs_human` rate is produced rather than
 * proposed, because a metric nobody emits is a plan, not a metric.
 */
export interface MetricsSnapshot {
  decided: number;
  needs_human: number;
  /** The headline. A fall means the system got confident -- see the README. */
  needs_human_rate: number;
  refunds: number;
  refunded_inr: number;
  /** Money returned per 100 tickets. Alerts on a policy mistake before a human notices. */
  refunded_inr_per_100: number;
  degraded: Record<string, number>;
  injections_flagged: number;
  idempotent_replays: number;
}

export class Metrics {
  private decided = 0;
  private needsHuman = 0;
  private refunds = 0;
  private refundedInr = 0;
  private injections = 0;
  private replays = 0;
  private readonly degraded = new Map<string, number>();

  record(decision: TriageResponse): void {
    if (decision.meta.idempotent_replay) {
      // A replay is not a new decision. Counting it would make the rates drift
      // with retry volume rather than with triage quality.
      this.replays++;
      return;
    }

    this.decided++;
    if (decision.needs_human) this.needsHuman++;
    if (decision.flags.prompt_injection_suspected) this.injections++;
    if (decision.refund.decision === 'refund') {
      this.refunds++;
      this.refundedInr += decision.refund.amount_inr;
    }
    if (decision.meta.degraded !== 'none') {
      this.degraded.set(decision.meta.degraded, (this.degraded.get(decision.meta.degraded) ?? 0) + 1);
    }
  }

  snapshot(): MetricsSnapshot {
    const rate = this.decided === 0 ? 0 : this.needsHuman / this.decided;
    const perHundred = this.decided === 0 ? 0 : (this.refundedInr / this.decided) * 100;

    return {
      decided: this.decided,
      needs_human: this.needsHuman,
      needs_human_rate: Number(rate.toFixed(3)),
      refunds: this.refunds,
      refunded_inr: this.refundedInr,
      refunded_inr_per_100: Number(perHundred.toFixed(2)),
      degraded: Object.fromEntries(this.degraded),
      injections_flagged: this.injections,
      idempotent_replays: this.replays,
    };
  }
}
