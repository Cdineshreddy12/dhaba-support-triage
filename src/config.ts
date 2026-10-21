import { readFileSync, existsSync } from 'node:fs';

/**
 * Loads .env without a dependency. We need four values; a library for that is
 * a supply-chain surface for no benefit.
 */
function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

export type TriageMode = 'live' | 'replay';

export interface Config {
  mode: TriageMode;
  apiKey: string | null;
  model: string;
  effort: 'low' | 'medium' | 'high';
  port: number;
  logLevel: string;
  confidenceFloor: number;
}

export function loadConfig(): Config {
  loadDotEnv();

  const requested = (process.env.TRIAGE_MODE ?? 'replay').toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;

  // Asking for live without a key is a configuration mistake, not a runtime
  // surprise. Fail at startup rather than on the first ticket.
  if (requested === 'live' && !apiKey) {
    throw new Error('TRIAGE_MODE=live requires ANTHROPIC_API_KEY. Use TRIAGE_MODE=replay to run without one.');
  }

  return {
    mode: requested === 'live' ? 'live' : 'replay',
    apiKey,
    model: process.env.TRIAGE_MODEL ?? 'claude-opus-5',
    effort: (process.env.TRIAGE_EFFORT as Config['effort']) ?? 'medium',
    port: Number(process.env.PORT ?? 3000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    confidenceFloor: Number(process.env.TRIAGE_CONFIDENCE_FLOOR ?? 0.55),
  };
}
