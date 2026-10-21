import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ModelVerdict } from '../domain/triage.js';
import { SYSTEM_PROMPT, buildUserMessage, redactLedger } from './prompt.js';
import { ClassifyInput, ModelProvider, ProviderResult } from './provider.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Per-attempt timeout in MILLISECONDS. The TS SDK uses ms, not seconds. */
  timeoutMs?: number;
  effort?: 'low' | 'medium' | 'high';
}

export class AnthropicProvider implements ModelProvider {
  readonly mode = 'live' as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: 'low' | 'medium' | 'high';

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // Transport retries only. Schema retries live in TriageService, because
      // they need a different fix. Capping both keeps worst case at 2x2.
      maxRetries: 1,
      timeout: opts.timeoutMs ?? 30_000,
    });
    this.model = opts.model;
    this.effort = opts.effort ?? 'medium';
  }

  async classify(input: ClassifyInput): Promise<ProviderResult> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        output_config: { effort: this.effort, format: zodOutputFormat(ModelVerdict) },
        messages: [{ role: 'user', content: this.render(input) }],
      });

      if (response.stop_reason === 'refusal') {
        return { ok: false, failure: 'invalid_output', detail: 'model declined the request' };
      }
      if (response.stop_reason === 'max_tokens') {
        return { ok: false, failure: 'invalid_output', detail: 'response truncated' };
      }

      // parsed_output is null when the response did not fit the schema.
      // Re-validating costs microseconds and this is the trust boundary.
      const parsed = ModelVerdict.safeParse(response.parsed_output);
      return parsed.success
        ? { ok: true, verdict: parsed.data }
        : { ok: false, failure: 'invalid_output', detail: issuePaths(parsed.error) };
    } catch (error) {
      return { ok: false, ...classifyError(error) };
    }
  }

  private render(input: ClassifyInput): string {
    const message = buildUserMessage(input.ticket, redactLedger(input.facts));
    if (!input.correction) return message;
    return `${message}\n\nYour previous response failed schema validation: ${input.correction}\nReturn a response that satisfies the schema exactly.`;
  }
}

/** Paths only, never values -- a rejected value may be ticket text. */
function issuePaths(error: z.ZodError): string {
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
