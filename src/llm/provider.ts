import { ModelVerdict } from '../domain/triage.js';
import { Ticket } from '../domain/ticket.js';
import { RedactedLedger } from './prompt.js';

export interface ClassifyInput {
  ticket: Ticket;
  ledger: RedactedLedger;
  /** Set on a retry: the validation error from the previous attempt, fed back as a correction. */
  correction?: string;
}

export type ProviderFailure = 'invalid_output' | 'unavailable' | 'timeout';

export type ProviderResult =
  | { ok: true; verdict: ModelVerdict }
  | { ok: false; failure: ProviderFailure; detail: string };

export interface ModelProvider {
  readonly mode: 'live' | 'replay';
  classify(input: ClassifyInput): Promise<ProviderResult>;
}
