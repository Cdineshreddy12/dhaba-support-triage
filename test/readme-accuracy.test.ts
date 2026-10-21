import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReplayProvider } from '../src/llm/replay.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { TriageService } from '../src/service/triage-service.js';
import { ALL_TICKETS, recordingLogger } from './helpers.js';
import type { TriageResponse } from '../src/domain/triage.js';

/**
 * Task 2 is called "make it not lie", so the README's claims about what the
 * service decided are tested rather than trusted.
 *
 * This exists because they drifted. The results table and the quoted T-1003
 * reply were both written against claude-opus-5 recordings, and after
 * re-recording on claude-sonnet-5 the README described output the code no
 * longer produced. Nothing failed, because nothing was checking.
 */

const README = readFileSync('README.md', 'utf8');

async function decideAll(): Promise<TriageResponse[]> {
  const { logger } = recordingLogger();
  const service = new TriageService({
    provider: new ReplayProvider(),
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: 0.6,
  });
  return Promise.all(ALL_TICKETS.map((t) => service.triage(t, `readme-${t.id}`)));
}

describe('the README describes what the service actually does', () => {
  it('every row of the results table matches a real decision', async () => {
    const results = await decideAll();

    for (const result of results) {
      const row = README.split('\n').find((line) => line.startsWith(`| ${result.ticket_id} |`));
      expect(row, `no table row for ${result.ticket_id}`).toBeDefined();

      const cells = row!.split('|').map((c) => c.trim());
      expect(cells[2], `${result.ticket_id} category`).toBe(result.category);
      expect(cells[3], `${result.ticket_id} severity`).toBe(result.severity);
      expect(cells[4], `${result.ticket_id} refund decision`).toBe(result.refund.decision);
      expect(cells[6], `${result.ticket_id} rule`).toBe(`\`${result.refund.rule_id}\``);
      expect(cells[8], `${result.ticket_id} needs_human`).toBe(result.needs_human ? '✓' : '');
    }
  });

  it('the headline counts match', async () => {
    const results = await decideAll();
    const humans = results.filter((r) => r.needs_human).length;
    const refunds = results.filter((r) => r.refund.decision === 'refund');
    const total = refunds.reduce((sum, r) => sum + r.refund.amount_inr, 0);

    expect(README).toContain(
      `12 tickets, ${humans} to a human, ${refunds.length} refunds, ₹${total} total.`,
    );
  });

  it('the quoted injection replies are the ones the service produces', async () => {
    // The brief asks to "show the output that proves it". A quote that has
    // drifted from the code proves the opposite.
    const results = await decideAll();

    for (const id of ['T-1003', 'T-1011']) {
      const result = results.find((r) => r.ticket_id === id)!;
      const opening = result.reply_draft.trim().split('\n')[0]!.slice(0, 60);
      expect(README, `${id}'s quoted reply has drifted from the code`).toContain(opening);
    }
  });

  it('the dashboard figure matches the needs_human rate', async () => {
    const results = await decideAll();
    const humans = results.filter((r) => r.needs_human).length;
    const percent = Math.round((humans / results.length) * 100);

    expect(README).toContain(`Currently ${humans}/12, ${percent}%.`);
  });
});
