/**
 * Records live model responses into fixtures/replay/ so the service runs
 * without a key. Usage:
 *   npx tsx scripts/record-fixtures.ts            # all tickets
 *   npx tsx scripts/record-fixtures.ts T-1003     # one ticket
 *
 * Requires ANTHROPIC_API_KEY. Everything else in the repo runs without it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { Ticket } from '../src/domain/ticket.js';
import { deriveLedger } from '../src/domain/ledger.js';
import { AnthropicProvider } from '../src/llm/anthropic.js';
import { redactLedger } from '../src/llm/prompt.js';

const cfg = loadConfig();
if (!cfg.apiKey) throw new Error('ANTHROPIC_API_KEY required to record fixtures');

const only = process.argv[2];
const raw = JSON.parse(readFileSync('fixtures/dhaba_tickets.json', 'utf8')) as { tickets: unknown[] };
const tickets = raw.tickets.map((t) => Ticket.parse(t)).filter((t) => !only || t.id === only);

const provider = new AnthropicProvider({ apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort });
mkdirSync('fixtures/replay', { recursive: true });

console.log(`model=${cfg.model} effort=${cfg.effort} tickets=${tickets.length}\n`);

for (const ticket of tickets) {
  const ledger = redactLedger(deriveLedger(ticket));
  const started = Date.now();
  const result = await provider.classify({ ticket, ledger });
  const ms = Date.now() - started;

  if (!result.ok) {
    console.log(`${ticket.id}  FAILED  ${result.failure}: ${result.detail}  (${ms}ms)`);
    continue;
  }
  writeFileSync(`fixtures/replay/${ticket.id}.json`, JSON.stringify(result.verdict, null, 2) + '\n');
  const v = result.verdict;
  console.log(
    `${ticket.id}  ${v.category}  ${v.severity}  claim=${v.claim_type}  lang=${v.language}  ` +
      `conf=${v.confidence}  human=${v.needs_human}  inj=${v.prompt_injection_suspected}  (${ms}ms)`,
  );
}
