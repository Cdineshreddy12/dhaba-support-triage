import { LedgerFacts } from '../domain/ledger.js';
import { Ticket } from '../domain/ticket.js';
import { ModelVerdict } from '../domain/triage.js';

export interface ClassifyInput {
  ticket: Ticket;
  facts: LedgerFacts;
  /** Set on a retry: the validation error from the previous attempt. */
  correction?: string;
}

export type ProviderFailure = 'invalid_output' | 'unavailable' | 'timeout';

export type ProviderResult =
  | { ok: true; verdict: ModelVerdict }
  | { ok: false; failure: ProviderFailure; detail: string };

/**
 * Providers receive raw LedgerFacts and decide for themselves what to send.
 * Redaction is a property of talking to a model, not of orchestration.
 */
export interface ModelProvider {
  readonly mode: 'live' | 'replay';
  classify(input: ClassifyInput): Promise<ProviderResult>;
}
