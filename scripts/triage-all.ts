/**
 * Runs all twelve fixture tickets and prints the result.
 *
 *   npm run triage:all                aligned table for a terminal
 *   npm run triage:all -- --markdown  the table the README embeds
 *   npm run triage:all -- --json      full responses
 *
 * Replay mode, so it needs no API key and gives identical output anywhere.
 */
import { readFileSync } from 'node:fs';
import { Ticket } from '../src/domain/ticket.js';
import { ReplayProvider } from '../src/llm/replay.js';
import { createLogger } from '../src/log.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { TriageService } from '../src/service/triage-service.js';
import { LoadShedder } from '../src/service/load-shedder.js';
import type { TriageResponse } from '../src/domain/triage.js';

const raw = JSON.parse(readFileSync('fixtures/dhaba_tickets.json', 'utf8')) as { tickets: unknown[] };
const tickets = raw.tickets.map((t) => Ticket.parse(t));

// --no-model sheds every model call, so the same twelve tickets run on the
// ledger and the rule table alone. Diff the two tables to see what the model
// is actually for, and what it has no say in.
const withoutModel = process.argv.includes('--no-model');

const service = new TriageService({
  provider: new ReplayProvider(),
  guard: new IdempotencyGuard(new InMemoryDecisionStore()),
  logger: createLogger('error'),
  confidenceFloor: Number(process.env.TRIAGE_CONFIDENCE_FLOOR ?? 0.6),
  ...(withoutModel && { shedder: new LoadShedder(0) }),
});

const results: TriageResponse[] = [];
for (const ticket of tickets) results.push(await service.triage(ticket, `cli-${ticket.id}`));

function money(r: TriageResponse): string {
  if (r.refund.decision === 'refund') return `₹${r.refund.amount_inr.toLocaleString('en-IN')} back`;
  if (r.refund.decision === 'hold_for_human') return 'held for a human';
  return '—';
}

function summary() {
  const humans = results.filter((r) => r.needs_human).length;
  const paid = results.filter((r) => r.refund.decision === 'refund');
  return { humans, refunds: paid.length, total: paid.reduce((s, r) => s + r.refund.amount_inr, 0) };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else if (process.argv.includes('--markdown')) {
  printMarkdown();
} else {
  printTable();
}

/** The shape the README embeds. */
function printMarkdown(): void {
  console.log('| ticket | decided | money | rule that fired | conf |');
  console.log('|---|---|---|---|---|');
  for (const r of results) {
    const marks = `${r.needs_human ? ' ✓' : ''}${r.flags.prompt_injection_suspected ? ' ⚠' : ''}`;
    const cell = r.refund.decision === 'refund' ? `**${money(r)}**` : money(r);
    console.log(
      `| ${r.ticket_id}${marks} | \`${r.category}\` ${r.severity} | ${cell} | ` +
        `\`${r.refund.rule_id}\` | ${r.confidence.toFixed(2)} |`,
    );
  }
  const { humans, refunds, total } = summary();
  console.log(`\n12 tickets, ${humans} to a human, ${refunds} refunds, ₹${total} total.`);
}

/** Readable in a terminal, which markdown is not. */
function printTable(): void {
  const ESC = '[';
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code: string, s: string) => (on ? `${ESC}${code}m${s}${ESC}0m` : s);

  const dim = (s: string) => paint('2', s);
  const bold = (s: string) => paint('1', s);
  const green = (s: string) => paint('32', s);
  const amber = (s: string) => paint('33', s);
  const sevColour: Record<string, string> = { p0: '31', p1: '33', p2: '36', p3: '2' };

  const rows = results.map((r) => ({
    id: r.ticket_id,
    marks: `${r.needs_human ? '✓' : ' '} ${r.flags.prompt_injection_suspected ? '⚠' : ' '}`,
    cat: r.category,
    sev: r.severity,
    money: money(r),
    paid: r.refund.decision === 'refund',
    rule: r.refund.rule_id,
    conf: r.confidence.toFixed(2),
  }));

  const head = { id: 'ticket', cat: 'category', money: 'money', rule: 'rule that fired', conf: 'conf' };
  const width = (key: 'id' | 'cat' | 'money' | 'rule' | 'conf') =>
    Math.max(head[key].length, ...rows.map((r) => r[key].length));

  // Ticket cell is `id` + two spaces + three marker chars, so +5.
  const cols = [width('id') + 5, width('cat') + 4, width('money'), width('rule'), width('conf')];
  const rule = (l: string, mid: string, r: string) =>
    dim(l + cols.map((n) => '─'.repeat(n + 2)).join(mid) + r);

  console.log();
  console.log(rule('┌', '┬', '┐'));
  console.log(
    dim('│ ') +
      bold(head.id.padEnd(cols[0]!)) + dim(' │ ') +
      bold(`${head.cat} sev`.padEnd(cols[1]!)) + dim(' │ ') +
      bold(head.money.padEnd(cols[2]!)) + dim(' │ ') +
      bold(head.rule.padEnd(cols[3]!)) + dim(' │ ') +
      bold(head.conf.padEnd(cols[4]!)) + dim(' │'),
  );
  console.log(rule('├', '┼', '┤'));

  for (const r of rows) {
    // Padding is computed on the plain string, then colour is applied, so the
    // escape codes never count toward the width.
    const id = (r.id + '  ' + r.marks).padEnd(cols[0]!);
    const cat = (r.cat + ' ' + r.sev).padEnd(cols[1]!);
    const catPainted = on
      ? cat.replace(r.sev, paint(sevColour[r.sev] ?? '2', r.sev))
      : cat;

    console.log(
      dim('│ ') +
        id.replace('✓', amber('✓')).replace('⚠', amber('⚠')) + dim(' │ ') +
        catPainted + dim(' │ ') +
        (r.paid ? green(r.money.padEnd(cols[2]!)) : dim(r.money.padEnd(cols[2]!))) + dim(' │ ') +
        dim(r.rule.padEnd(cols[3]!)) + dim(' │ ') +
        r.conf.padEnd(cols[4]!) + dim(' │'),
    );
  }
  console.log(rule('└', '┴', '┘'));

  const { humans, refunds, total } = summary();
  console.log(
    `\n  ${bold(String(results.length))} tickets   ` +
      `${bold(String(humans))} to a human ${amber('✓')}   ` +
      `${bold(String(refunds))} refunds   ${green('₹' + total.toLocaleString('en-IN'))}\n`,
  );
  const modes = [...new Set(results.map((r) => r.meta.mode))].join(', ');
  if (withoutModel) {
    console.log(dim(`  mode: ${modes} — every model call shed, so no claim type was produced`));
    console.log(dim('  and nothing can be refunded. The ledger still decided; it just was not asked.'));
  } else {
    console.log(dim(`  mode: ${modes} — categories, severities and drafts are recorded model`));
    console.log(dim('  output (fixtures/replay, see __recorded); the money is computed every run'));
  }
  console.log(dim('  ✓ needs a human    ⚠ contains text aimed at the assistant'));
  console.log(dim('  --markdown for the README table    --json for full responses\n'));
}
