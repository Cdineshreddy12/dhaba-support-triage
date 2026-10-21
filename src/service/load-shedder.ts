/**
 * Caps how many model calls are in flight at once, and sheds the rest.
 *
 * The first rung of the degradation ladder in the README. Under an outage the
 * model is the only slow part, so it is the first thing to drop: the ledger and
 * the rule table are pure functions over data already in the request, and they
 * do not care how busy the process is.
 *
 * Shedding is not queueing. A shed request is decided now, by the rules, and
 * marked `load_shed` -- it does not wait for a slot. Waiting is what turns an
 * overloaded endpoint into a timing-out one.
 */
export class LoadShedder {
  private inFlight = 0;

  /** `limit` of 0 sheds everything, which is how the tests force the path. */
  constructor(private readonly limit: number) {}

  get shedding(): boolean {
    return this.inFlight >= this.limit;
  }

  get depth(): number {
    return this.inFlight;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.inFlight++;
    try {
      return await work();
    } finally {
      this.inFlight--;
    }
  }
}
