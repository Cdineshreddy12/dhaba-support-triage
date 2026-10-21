import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ModelVerdict } from '../domain/triage.js';
import { ClassifyInput, ModelProvider, ProviderResult } from './provider.js';

/**
 * Replays recorded model responses. No network, no key.
 *
 * This is the default mode and the one CI runs, so an evaluator can clone the
 * repo and get identical output without spending anything. It is not a test
 * double bolted on afterwards -- `npm run triage:all` and every test run
 * against it, which is what keeps the recordings honest.
 *
 * A fixture may also record a FAILURE. That is how the degrade path is
 * exercised deterministically: fixtures/replay/__malformed.json produces output
 * that cannot satisfy the schema, so the retry-then-fallback path runs in CI
 * rather than only in production.
 */
export class ReplayProvider implements ModelProvider {
  readonly mode = 'replay' as const;

  constructor(
    private readonly dir: string = 'fixtures/replay',
    /** Ticket ids whose SECOND attempt should succeed, to exercise retry-then-recover. */
    private readonly recoverOnRetry: Set<string> = new Set(),
  ) {}

  async classify(input: ClassifyInput): Promise<ProviderResult> {
    const id = input.ticket.id;

    if (input.correction && this.recoverOnRetry.has(id)) {
      return this.load(id, `${id}.retry`);
    }
    return this.load(id, id);
  }

  private load(ticketId: string, fixtureName: string): ProviderResult {
    const path = join(this.dir, `${fixtureName}.json`);
    if (!existsSync(path)) {
      return {
        ok: false,
        failure: 'unavailable',
        detail: `no recorded response for ${ticketId}`,
      };
    }

    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));

    // A recorded failure: { "__failure": "timeout", "detail": "..." }
    if (isRecordedFailure(raw)) {
      return { ok: false, failure: raw.__failure, detail: raw.detail ?? 'recorded failure' };
    }

    const parsed = ModelVerdict.safeParse(raw);
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

interface RecordedFailure {
  __failure: 'invalid_output' | 'unavailable' | 'timeout';
  detail?: string;
}

function isRecordedFailure(value: unknown): value is RecordedFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__failure' in value &&
    typeof (value as { __failure: unknown }).__failure === 'string'
  );
}
