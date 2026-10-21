/**
 * A logger that cannot leak a ticket.
 *
 * The context type below is a closed set of ids, enums, numbers and booleans.
 * There is deliberately no `extra: Record<string, unknown>` escape hatch,
 * because that is where a subject or body eventually gets passed "just for
 * debugging" and then ships.
 *
 * T-1010's body contains a company name and a GSTIN. T-1002's contains a device
 * model. Any logger that accepts free text will eventually carry them.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Everything loggable. Adding a field here is a reviewed decision, in one place. */
export interface LogContext {
  request_id?: string;
  ticket_id?: string;
  mode?: string;
  degraded?: string;
  model_attempts?: number;
  idempotent_replay?: boolean;
  category?: string;
  severity?: string;
  claim_type?: string;
  language?: string;
  confidence?: number;
  needs_human?: boolean;
  prompt_injection_suspected?: boolean;
  refund_decision?: string;
  refund_amount_inr?: number;
  refund_reason?: string;
  rule_id?: string;
  captured_count?: number;
  captured_total_inr?: number;
  duration_ms?: number;
  status_code?: number;
  /** Zod issue PATHS only, never the rejected values. */
  validation_issues?: string;
  /** Provider failure class, never the provider's message body. */
  failure?: string;
  detail?: string;
  error?: string;
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(bound: LogContext): Logger;
}

export function createLogger(level: LogLevel = 'info', bound: LogContext = {}): Logger {
  const threshold = LEVEL_ORDER[level];

  const emit = (lvl: LogLevel, msg: string, ctx?: LogContext): void => {
    if (LEVEL_ORDER[lvl] < threshold) return;
    const line = { level: lvl, msg, ...bound, ...ctx };
    const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(line) + '\n');
  };

  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    child: (extra) => createLogger(level, { ...bound, ...extra }),
  };
}
