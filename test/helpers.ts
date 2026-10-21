import { readFileSync } from 'node:fs';
import { Ticket } from '../src/domain/ticket.js';
import { LogContext, Logger } from '../src/log.js';
import { ModelProvider, ClassifyInput, ProviderResult } from '../src/llm/provider.js';

const raw = JSON.parse(readFileSync('fixtures/dhaba_tickets.json', 'utf8')) as { tickets: unknown[] };
export const ALL_TICKETS = raw.tickets.map((t) => Ticket.parse(t));

export function ticket(id: string): Ticket {
  const t = ALL_TICKETS.find((x) => x.id === id);
  if (!t) throw new Error(`fixture ${id} missing`);
  return t;
}

/** A ticket id that has no recorded fixture, reshaped from a real one. */
export function syntheticTicket(id: string, from = 'T-1006'): Ticket {
  return { ...ticket(from), id };
}

export interface RecordedLine {
  level: string;
  msg: string;
  ctx: LogContext;
}

export function recordingLogger(): { logger: Logger; lines: RecordedLine[] } {
  const lines: RecordedLine[] = [];
  const make = (bound: LogContext): Logger => ({
    debug: (msg, ctx) => lines.push({ level: 'debug', msg, ctx: { ...bound, ...ctx } }),
    info: (msg, ctx) => lines.push({ level: 'info', msg, ctx: { ...bound, ...ctx } }),
    warn: (msg, ctx) => lines.push({ level: 'warn', msg, ctx: { ...bound, ...ctx } }),
    error: (msg, ctx) => lines.push({ level: 'error', msg, ctx: { ...bound, ...ctx } }),
    child: (extra) => make({ ...bound, ...extra }),
  });
  return { logger: make({}), lines };
}

/** Wraps a provider and counts calls, so idempotency can be asserted on work done. */
export class CountingProvider implements ModelProvider {
  calls = 0;
  readonly mode: 'live' | 'replay';

  constructor(private readonly inner: ModelProvider) {
    this.mode = inner.mode;
  }

  async classify(input: ClassifyInput): Promise<ProviderResult> {
    this.calls++;
    return this.inner.classify(input);
  }
}

/** Always fails, to drive the degrade path without any fixture. */
export class DeadProvider implements ModelProvider {
  readonly mode = 'replay' as const;
  constructor(private readonly failure: 'unavailable' | 'timeout' = 'unavailable') {}
  async classify(): Promise<ProviderResult> {
    return { ok: false, failure: this.failure, detail: 'provider down' };
  }
}
