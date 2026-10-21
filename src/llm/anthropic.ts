import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ModelVerdict } from '../domain/triage.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { ClassifyInput, ModelProvider, ProviderResult } from './provider.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Per-attempt timeout in MILLISECONDS -- the TS SDK uses ms, unlike the Python SDK. */
  timeoutMs?: number;
  effort?: 'low' | 'medium' | 'high';
}

/**
 * Two retry layers exist and they are deliberately separate:
 *
 *   maxRetries here  -- transport failures (429, 5xx, dropped connections).
 *                       The SDK handles these; we do not.
 *   the retry in TriageService -- a response that arrived fine but did not
 *                       satisfy ModelVerdict. A different failure, needing a
 *                       different fix (feeding the error back), so it lives
 *                       with the orchestration rather than here.
 *
 * Kept at 1 so worst-case latency stays bounded: 2 transport attempts x 2
 * validation attempts, not 3 x 3.
 */
export class AnthropicProvider implements ModelProvider {
  readonly mode = 'live' as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: 'low' | 'medium' | 'high';

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      maxRetries: 1,
      timeout: opts.timeoutMs ?? 30_000,
    });
    this.model = opts.model;
    this.effort = opts.effort ?? 'medium';
  }

  async classify(input: ClassifyInput): Promise<ProviderResult> {
    const content = input.correction
      ? `${buildUserMessage(input.ticket, input.ledger)}\n\nYour previous response was rejected by schema validation: ${input.correction}\nReturn a response that satisfies the schema exactly.`
      : buildUserMessage(input.ticket, input.ledger);

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        output_config: {
          effort: this.effort,
          format: zodOutputFormat(ModelVerdict),
        },
        messages: [{ role: 'user', content }],
      });

      if (response.stop_reason === 'refusal') {
        return { ok: false, failure: 'invalid_output', detail: 'model declined the request' };
      }
      if (response.stop_reason === 'max_tokens') {
        return { ok: false, failure: 'invalid_output', detail: 'response truncated at max_tokens' };
      }

      // parsed_output is null when the response could not be parsed into the schema.
      // Re-validate rather than trusting it: this is the boundary, and the cost is microseconds.
      const parsed = ModelVerdict.safeParse(response.parsed_output);
      if (!parsed.success) {
        return { ok: false, failure: 'invalid_output', detail: issueSummary(parsed.error) };
      }
      return { ok: true, verdict: parsed.data };
    } catch (error) {
      return { ok: false, ...classifyError(error) };
    }
  }
}

/** Only issue PATHS, never values -- a rejected value may be user text. See the observability skill. */
function issueSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '<root>'}:${i.code}`)
    .join(', ');
}

function classifyError(error: unknown): { failure: 'unavailable' | 'timeout'; detail: string } {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return { failure: 'timeout', detail: 'request timed out' };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { failure: 'unavailable', detail: 'rate limited' };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { failure: 'unavailable', detail: 'authentication rejected' };
  }
  if (error instanceof Anthropic.APIError) {
    return { failure: 'unavailable', detail: `api error ${error.status ?? 'unknown'}` };
  }
  return { failure: 'unavailable', detail: 'unexpected provider error' };
}
