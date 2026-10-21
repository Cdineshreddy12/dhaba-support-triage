import { Purchase, Ticket } from './ticket.js';

/**
 * Pure derivation of what actually happened to this user's money.
 *
 * Everything here reads `purchases[]` and timestamps. Nothing here reads the
 * subject or the body. That separation is deliberate: the refund gate consumes
 * LedgerFacts, so no amount of persuasion, threat, or injected instruction in
 * the ticket text can reach a money decision.
 */

/** Two captures of the same amount inside this window are treated as a double charge. */
const DUPLICATE_WINDOW_HOURS = 24;

/** A trial converting to a paid plan within this window is the documented auto-conversion. */
const TRIAL_CONVERSION_WINDOW_HOURS = 48;

const MS_PER_HOUR = 3_600_000;

/** Unsigned gap. Only for spacing between two events whose order is already known. */
const hoursBetween = (a: string, b: string): number =>
  Math.abs(new Date(b).getTime() - new Date(a).getTime()) / MS_PER_HOUR;

/**
 * SIGNED elapsed time: negative when `from` is after `to`.
 *
 * Deliberately not Math.abs. `hours_since_last_capture` feeds the remorse
 * window, and an absolute value turns "this charge has not happened yet" into
 * "this charge happened moments ago" -- which reads as a fresh capture and
 * refunds it. Clock skew between billing and the help form, a backfilled
 * payment, or a ticket sitting in a queue while a charge lands are all enough
 * to produce that ordering.
 */
const hoursElapsed = (from: string, to: string): number =>
  (new Date(to).getTime() - new Date(from).getTime()) / MS_PER_HOUR;

const byTimeAsc = (a: Purchase, b: Purchase): number =>
  new Date(a.at).getTime() - new Date(b.at).getTime();

export interface DuplicateCapture {
  original_id: string;
  duplicate_id: string;
  amount_inr: number;
  hours_apart: number;
}

export interface TrialConversion {
  trial_id: string;
  converted_id: string;
  converted_amount_inr: number;
  hours_after_trial: number;
}

export interface LedgerFacts {
  /** Payments where money actually moved. The ONLY basis for any refund amount. */
  captured: Purchase[];
  captured_count: number;
  captured_total_inr: number;
  last_capture: Purchase | null;
  /**
   * Hours from the last capture to the ticket arriving. SIGNED: negative means
   * the capture is timestamped after the ticket, which should not happen and
   * must never be read as a recent charge. Rules guard on `>= 0`.
   */
  hours_since_last_capture: number | null;

  /** Attempts that took no money but which a user may genuinely believe were charges. */
  uncaptured: Purchase[];
  has_uncaptured_attempts: boolean;

  /**
   * True when the user is complaining about money that never left their account:
   * there are failed/initiated attempts on file and nothing recent was captured.
   * This is the T-1005 and T-1009 shape.
   */
  claimed_charge_is_uncaptured: boolean;

  duplicate_capture: DuplicateCapture | null;
  trial_conversion: TrialConversion | null;

  /** Last captured payment succeeded => the user should have a working paid plan. */
  has_active_entitlement: boolean;

  /** Last renewal attempt failed => user may believe they are subscribed and is not. */
  entitlement_lapsed: boolean;

  app_opens_since_renewal: number;
  /** Charged, then never opened the app. Strongest "they got nothing for it" signal. */
  unused_since_last_capture: boolean;
}

export function deriveLedger(ticket: Ticket): LedgerFacts {
  const all = [...ticket.purchases].sort(byTimeAsc);
  const captured = all.filter((p) => p.status === 'successful');
  const uncaptured = all.filter((p) => p.status !== 'successful');

  const last_capture = captured.length > 0 ? captured[captured.length - 1]! : null;
  const latestAttempt = all.length > 0 ? all[all.length - 1]! : null;

  const hours_since_last_capture = last_capture
    ? hoursElapsed(last_capture.at, ticket.received_at)
    : null;

  return {
    captured,
    captured_count: captured.length,
    captured_total_inr: captured.reduce((sum, p) => sum + p.amount_inr, 0),
    last_capture,
    hours_since_last_capture,

    uncaptured,
    has_uncaptured_attempts: uncaptured.length > 0,
    claimed_charge_is_uncaptured:
      uncaptured.length > 0 && latestAttempt !== null && latestAttempt.status !== 'successful',

    duplicate_capture: findDuplicateCapture(captured),
    trial_conversion: findTrialConversion(all),

    has_active_entitlement: last_capture !== null,
    entitlement_lapsed:
      latestAttempt !== null && latestAttempt.status === 'failed' && latestAttempt.type === 'renewal',

    app_opens_since_renewal: ticket.app_opens_since_renewal,
    unused_since_last_capture: last_capture !== null && ticket.app_opens_since_renewal === 0,
  };
}

/**
 * A double charge means money left the account twice. A failed attempt beside a
 * successful one is ONE charge that the bank may have shown the user twice --
 * it is not a duplicate and must not produce a refund. (Ticket T-1009.)
 */
function findDuplicateCapture(captured: Purchase[]): DuplicateCapture | null {
  for (let i = 1; i < captured.length; i++) {
    const prev = captured[i - 1]!;
    const curr = captured[i]!;
    const apart = hoursBetween(prev.at, curr.at);
    if (curr.amount_inr === prev.amount_inr && apart <= DUPLICATE_WINDOW_HOURS) {
      return {
        original_id: prev.id,
        duplicate_id: curr.id,
        amount_inr: curr.amount_inr,
        hours_apart: Number(apart.toFixed(2)),
      };
    }
  }
  return null;
}

/** The Rs 1 trial followed by the real plan activating on its own. */
function findTrialConversion(all: Purchase[]): TrialConversion | null {
  const trial = all.find((p) => p.type === 'trial' && p.status === 'successful');
  if (!trial) return null;

  const converted = all.find(
    (p) =>
      p.type === 'renewal' &&
      p.status === 'successful' &&
      new Date(p.at).getTime() > new Date(trial.at).getTime() &&
      hoursBetween(trial.at, p.at) <= TRIAL_CONVERSION_WINDOW_HOURS,
  );
  if (!converted) return null;

  return {
    trial_id: trial.id,
    converted_id: converted.id,
    converted_amount_inr: converted.amount_inr,
    hours_after_trial: Number(hoursBetween(trial.at, converted.at).toFixed(2)),
  };
}
