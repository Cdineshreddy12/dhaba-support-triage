import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ModelVerdict } from '../domain/triage.js';
import { ClassifyInput, ModelProvider, ProviderResult } from './provider.js';

interface RecordedFailure {
  __failure: 'invalid_output' | 'unavailable' | 'timeout';
  detail?: string;
}

/**
 * Replays recorded responses. No network, no key. The default mode, and what
 * CI runs.
 *
 * A fixture can record a failure as well as a verdict, which is how the
 * degrade path gets exercised deterministically.
 */
export class ReplayProvider implements ModelProvider {
  readonly mode = 'replay' as const;

  constructor(
    private readonly dir: string = 'fixtures/replay',
    /** Ticket ids whose second attempt should succeed, for retry-then-recover. */
    private readonly recoverOnRetry: Set<string> = new Set(),
  ) {}

  async classify(input: ClassifyInput): Promise<ProviderResult> {
    const id = input.ticket.id;
    const useRetryFixture = input.correction && this.recoverOnRetry.has(id);
    return this.load(id, useRetryFixture ? `${id}.retry` : id);
  }

  private load(ticketId: string, fixtureName: string): ProviderResult {
    const path = join(this.dir, `${fixtureName}.json`);
    if (!existsSync(path)) {
      return { ok: false, failure: 'unavailable', detail: `no recording for ${ticketId}` };
    }

    // Unparseable output is a failure to report, not an exception to throw.
    // The brief names prose and truncated json alongside an invented category,
    // and only the last of those reaches the schema at all.
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return { ok: false, failure: 'invalid_output', detail: 'response was not json' };
    }

    if (isRecordedFailure(raw)) {
      return { ok: false, failure: raw.__failure, detail: raw.detail ?? 'recorded failure' };
    }

    // `__`-prefixed keys are provenance, not part of the model's output.
    const verdict =
      typeof raw === 'object' && raw !== null
        ? Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('__')))
        : raw;

    const parsed = ModelVerdict.safeParse(verdict);
    if (!parsed.success) {
      return {
        ok: false,
        failure: 'invalid_output',
        detail: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.map(String).join('.') || '<root>'}:${i.code}`)
          .join(', '),
      };
    }
    return { ok: true, verdict: parsed.data };
  }
}

function isRecordedFailure(value: unknown): value is RecordedFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__failure' in value &&
    typeof (value as { __failure: unknown }).__failure === 'string'
  );
}
