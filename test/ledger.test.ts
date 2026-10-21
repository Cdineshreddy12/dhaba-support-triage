import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ticket } from '../src/domain/ticket.js';
import { deriveLedger } from '../src/domain/ledger.js';

const raw = JSON.parse(readFileSync('fixtures/dhaba_tickets.json', 'utf8')) as { tickets: unknown[] };
const tickets = raw.tickets.map((t) => Ticket.parse(t));
const byId = (id: string) => {
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new Error(`fixture ${id} missing`);
  return t;
};
const ledgerFor = (id: string) => deriveLedger(byId(id));

describe('the fixture parses against the inbound schema', () => {
  it('accepts all twelve tickets, including the +05:30 offsets', () => {
    expect(tickets).toHaveLength(12);
  });
});

describe('a failed attempt beside a successful one is ONE charge', () => {
  // T-1009 says "you took 249 twice". The ledger says one capture, one failure.
  // If this test ever goes green on a duplicate, we are refunding money we never took.
  it('T-1009 is not a duplicate capture', () => {
    const l = ledgerFor('T-1009');
    expect(l.duplicate_capture).toBeNull();
    expect(l.captured_count).toBe(1);
    expect(l.captured_total_inr).toBe(249);
  });

  it('T-1009 records the failed attempt as a perceived-but-uncaptured charge', () => {
    const l = ledgerFor('T-1009');
    expect(l.has_uncaptured_attempts).toBe(true);
    expect(l.uncaptured.map((p) => p.id)).toEqual(['pay_I1']);
  });
});

describe('an initiated payment never took money', () => {
  // T-1005: "paisa kat gaya" -- the user believes they were charged Rs 249.
  // pay_E2 is `initiated`. The only capture on this account is the Rs 1 trial.
  it('T-1005 has captured only the trial rupee', () => {
    const l = ledgerFor('T-1005');
    expect(l.captured_total_inr).toBe(1);
    expect(l.claimed_charge_is_uncaptured).toBe(true);
  });
});

describe('trial auto-conversion is visible in the ledger', () => {
  it('T-1001 converted from the Rs 1 trial about 24h later', () => {
    const l = ledgerFor('T-1001');
    expect(l.trial_conversion).not.toBeNull();
    expect(l.trial_conversion?.converted_amount_inr).toBe(249);
    expect(l.trial_conversion?.hours_after_trial).toBeCloseTo(24.03, 1);
  });

  it('T-1006 has no trial on file, so the annual charge is not a conversion', () => {
    expect(ledgerFor('T-1006').trial_conversion).toBeNull();
  });
});

describe('entitlement state', () => {
  it('T-1007 last renewal failed, so the user is lapsed without knowing it', () => {
    const l = ledgerFor('T-1007');
    expect(l.entitlement_lapsed).toBe(true);
  });

  it('T-1011 has no purchases at all', () => {
    const l = ledgerFor('T-1011');
    expect(l.captured_count).toBe(0);
    expect(l.has_active_entitlement).toBe(false);
  });
});

describe('charged-and-never-opened', () => {
  it.each([
    ['T-1001', true],
    ['T-1006', true],
    ['T-1008', true],
    ['T-1002', false],
    ['T-1012', false],
  ])('%s unused_since_last_capture = %s', (id, expected) => {
    expect(ledgerFor(id).unused_since_last_capture).toBe(expected);
  });
});
