import type { Ticket, TriageResponse } from './types';

export async function fetchTickets(): Promise<Ticket[]> {
  const response = await fetch('/tickets');
  if (!response.ok) throw new Error(`could not load tickets (${response.status})`);
  return response.json();
}

export interface Health {
  mode: string;
  model: string | null;
  replay_fixtures_present: boolean;
}

export async function fetchHealth(): Promise<Health> {
  const response = await fetch('/readyz');
  if (!response.ok) throw new Error(`service not ready (${response.status})`);
  return response.json();
}

export interface TriageError {
  error: string;
  issues?: Array<{ path: string; code: string }>;
}

/** Returns the decision, or the server's validation errors for a bad ticket. */
export async function triage(
  ticket: unknown,
): Promise<{ ok: true; data: TriageResponse } | { ok: false; error: TriageError }> {
  const response = await fetch('/triage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ticket),
  });

  const body = await response.json();
  return response.ok ? { ok: true, data: body } : { ok: false, error: body };
}
