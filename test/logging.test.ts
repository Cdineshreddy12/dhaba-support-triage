import { describe, expect, it } from 'vitest';
import { ReplayProvider } from '../src/llm/replay.js';
import { IdempotencyGuard, InMemoryDecisionStore } from '../src/service/idempotency.js';
import { TriageService } from '../src/service/triage-service.js';
import { ALL_TICKETS, recordingLogger } from './helpers.js';

/**
 * The brief: "nothing in these tickets that identifies a person or a company
 * should end up in a log line."
 *
 * These tests run every ticket through the service and inspect what the logger
 * actually received, rather than trusting that no call site passed a body.
 */

async function runAllAndCaptureLogs(): Promise<string> {
  const { logger, lines } = recordingLogger();
  const service = new TriageService({
    provider: new ReplayProvider(),
    guard: new IdempotencyGuard(new InMemoryDecisionStore()),
    logger,
    confidenceFloor: 0.55,
  });
  for (const t of ALL_TICKETS) await service.triage(t, `req-${t.id}`);
  return JSON.stringify(lines);
}

describe('logs carry no person or company', () => {
  it('the GSTIN and company name in T-1010 never reach a log line', async () => {
    const logs = await runAllAndCaptureLogs();
    expect(logs).not.toContain('29ABCDE1234F1Z5');
    expect(logs.toLowerCase()).not.toContain('acme interiors');
    expect(logs.toLowerCase()).not.toContain('acme');
  });

  it('the device string in T-1002 never reaches a log line', async () => {
    const logs = await runAllAndCaptureLogs();
    expect(logs.toLowerCase()).not.toContain('redmi');
    expect(logs.toLowerCase()).not.toContain('android 13');
  });

  it('the family detail in T-1008 never reaches a log line', async () => {
    const logs = await runAllAndCaptureLogs();
    expect(logs.toLowerCase()).not.toContain('my father');
    expect(logs.toLowerCase()).not.toContain('cyber cell');
  });

  it('no 24-character run of ANY ticket body or subject appears in the logs', async () => {
    // The generic property. Catches a body reaching logs through a field nobody
    // thought of, including one added later.
    const logs = await runAllAndCaptureLogs();
    const WINDOW = 24;

    for (const t of ALL_TICKETS) {
      const text = `${t.subject}\n${t.body}`;
      for (let i = 0; i + WINDOW <= text.length; i++) {
        const window = text.slice(i, i + WINDOW);
        expect(logs, `${t.id} leaked: ${JSON.stringify(window)}`).not.toContain(window);
      }
    }
  });

  it('the model reply draft and summary are never logged', async () => {
    // Both paraphrase the user. Logging them is the subtle version of the leak.
    const { logger, lines } = recordingLogger();
    const service = new TriageService({
      provider: new ReplayProvider(),
      guard: new IdempotencyGuard(new InMemoryDecisionStore()),
      logger,
      confidenceFloor: 0.55,
    });
    const result = await service.triage(ALL_TICKETS[0]!, 'req-1');
    const logs = JSON.stringify(lines);

    expect(logs).not.toContain(result.summary);
    expect(logs).not.toContain(result.reply_draft.slice(0, 30));
  });
});

describe('logs are enough to explain a refund without opening the ticket', () => {
  it('a decision line carries rule_id, reason, amount and the ledger basis', async () => {
    const { logger, lines } = recordingLogger();
    const service = new TriageService({
      provider: new ReplayProvider(),
      guard: new IdempotencyGuard(new InMemoryDecisionStore()),
      logger,
      confidenceFloor: 0.55,
    });
    await service.triage(ALL_TICKETS.find((t) => t.id === 'T-1006')!, 'req-6');

    const decided = lines.find((l) => l.msg === 'triage decided');
    expect(decided).toBeDefined();
    expect(decided!.ctx).toMatchObject({
      ticket_id: 'T-1006',
      request_id: 'req-6',
      refund_decision: 'refund',
      refund_amount_inr: 1499,
      rule_id: 'R5_REMORSE_WINDOW',
      captured_total_inr: 2998,
    });
  });
});
