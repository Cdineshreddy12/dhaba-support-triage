/**
 * Runs all twelve fixture tickets through the service and prints a markdown
 * table. Replay mode, so it needs no API key and produces identical output on
 * any machine. The README's task 2 table is generated from this.
 *
 *   npm run triage:all            # markdown table
 *   npm run triage:all -- --json  # full responses
 */
import { readFileSync } from 'node:fs';
import { Ticket } from '../src/domain/ticket.js';
import { ReplayProvider } from '../src/llm/replay.js';
import { createLogger } from '../src/log.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { TriageService } from '../src/service/triage-service.js';

const raw = JSON.parse(readFileSync('fixtures/dhaba_tickets.json', 'utf8')) as { tickets: unknown[] };
const tickets = raw.tickets.map((t) => Ticket.parse(t));

const service = new TriageService({
  provider: new ReplayProvider(),
  guard: new IdempotencyGuard(new InMemoryDecisionStore()),
  logger: createLogger('error'),
  confidenceFloor: Number(process.env.TRIAGE_CONFIDENCE_FLOOR ?? 0.6),
});

const results = [];
for (const ticket of tickets) {
  results.push(await service.triage(ticket, `cli-${ticket.id}`));
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('| ticket | category | sev | refund | amount | rule | conf | human | inj |');
  console.log('|---|---|---|---|---:|---|---:|:-:|:-:|');
  for (const r of results) {
    const amount = r.refund.amount_inr > 0 ? `₹${r.refund.amount_inr}` : '—';
    console.log(
      `| ${r.ticket_id} | ${r.category} | ${r.severity} | ${r.refund.decision} | ${amount} | ` +
        `\`${r.refund.rule_id}\` | ${r.confidence.toFixed(2)} | ${r.needs_human ? '✓' : ''} | ` +
        `${r.flags.prompt_injection_suspected ? '⚠' : ''} |`,
    );
  }
  const humans = results.filter((r) => r.needs_human).length;
  const payouts = results.filter((r) => r.refund.decision === 'refund');
  console.log(
    `\n${results.length} tickets · ${humans} to a human · ${payouts.length} refunds ` +
      `· ₹${payouts.reduce((s, r) => s + r.refund.amount_inr, 0)} total`,
  );
}
