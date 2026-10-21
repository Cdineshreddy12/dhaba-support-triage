import { TriageResponse } from '../domain/triage.js';

/**
 * "The same ticket id arriving again must not refund twice."
 *
 * Two distinct races have to be handled, and only one of them is obvious:
 *
 *   1. Sequential repeat -- the ticket was decided minutes ago. Return the
 *      stored decision.
 *   2. Concurrent repeat -- two requests for the same id are in flight at once,
 *      so neither has stored anything yet. A store-after-the-fact cache lets
 *      both through and both decide a refund. This is the one that actually
 *      pays twice, and it is the realistic shape during a retry storm.
 *
 * The in-flight promise map closes (2): the second caller awaits the first
 * caller's work instead of starting its own.
 *
 * In-memory because this is one process. The interface is what matters -- the
 * production shape is a row keyed on ticket_id with a unique constraint, so the
 * database rejects the second decision rather than the process remembering not
 * to make it. See the backend track notes in the README.
 */
export interface DecisionStore {
  get(ticketId: string): Promise<TriageResponse | null>;
  put(ticketId: string, decision: TriageResponse): Promise<void>;
}

export class InMemoryDecisionStore implements DecisionStore {
  private readonly decisions = new Map<string, TriageResponse>();

  async get(ticketId: string): Promise<TriageResponse | null> {
    return this.decisions.get(ticketId) ?? null;
  }

  async put(ticketId: string, decision: TriageResponse): Promise<void> {
    this.decisions.set(ticketId, decision);
  }
}

export class IdempotencyGuard {
  private readonly inFlight = new Map<string, Promise<TriageResponse>>();

  constructor(private readonly store: DecisionStore) {}

  /**
   * Runs `decide` at most once per ticket id. Returns the decision plus whether
   * it came from a previous run, so the caller can report it honestly rather
   * than silently pretending it just decided.
   */
  async once(
    ticketId: string,
    decide: () => Promise<TriageResponse>,
  ): Promise<{ decision: TriageResponse; replayed: boolean }> {
    const stored = await this.store.get(ticketId);
    if (stored) return { decision: stored, replayed: true };

    const pending = this.inFlight.get(ticketId);
    if (pending) return { decision: await pending, replayed: true };

    const work = decide()
      .then(async (decision) => {
        await this.store.put(ticketId, decision);
        return decision;
      })
      .finally(() => {
        this.inFlight.delete(ticketId);
      });

    this.inFlight.set(ticketId, work);
    return { decision: await work, replayed: false };
  }
}
