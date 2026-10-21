import { TriageResponse } from '../domain/triage.js';

/**
 * Production shape is a row keyed on ticket_id with a unique constraint, so the
 * database rejects a second decision rather than the process remembering not to
 * make one. In-memory here because this is a single process.
 */
export interface DecisionStore {
  get(ticketId: string): Promise<TriageResponse | null>;
  put(ticketId: string, decision: TriageResponse): Promise<void>;
}

/**
 * Bounded, because an unbounded Map in a long-running process is a leak.
 *
 * Eviction is FIFO on insertion order, and it has a real cost: an evicted
 * ticket is no longer protected, so a re-POST after eviction decides again.
 * That is the honest limit of doing this in memory, and the reason the
 * production shape is a row with a unique constraint — the database cannot
 * forget. See the storage sketch in the README.
 */
export class InMemoryDecisionStore implements DecisionStore {
  private readonly decisions = new Map<string, TriageResponse>();

  constructor(private readonly maxEntries = 10_000) {}

  async get(ticketId: string): Promise<TriageResponse | null> {
    return this.decisions.get(ticketId) ?? null;
  }

  async put(ticketId: string, decision: TriageResponse): Promise<void> {
    if (!this.decisions.has(ticketId) && this.decisions.size >= this.maxEntries) {
      const oldest = this.decisions.keys().next().value;
      if (oldest !== undefined) this.decisions.delete(oldest);
    }
    this.decisions.set(ticketId, decision);
  }

  get size(): number {
    return this.decisions.size;
  }
}

export class IdempotencyGuard {
  private readonly inFlight = new Map<string, Promise<TriageResponse>>();

  constructor(private readonly store: DecisionStore) {}

  /**
   * Runs `decide` at most once per ticket id.
   *
   * Two races, and only the first is obvious. A sequential repeat is served
   * from the store. A CONCURRENT repeat -- two requests in flight before either
   * has stored anything -- is the one that actually pays twice, and it is what
   * a retry storm looks like. The in-flight map makes the second caller await
   * the first instead of starting its own decision.
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
