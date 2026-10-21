---
name: money-gate
description: Rules for anything that touches refunds, amounts, or the purchase ledger in the Dhaba triage service - src/domain/ledger.ts and src/domain/refund-policy.ts. Load before adding or changing a refund rule, changing the remorse window, reading purchases[], or debugging why a ticket did or did not get money back. Also load when a reviewer asks "could a crafted ticket get a payout".
---

# The money gate

`src/domain/refund-policy.ts` is the only place in this codebase where an amount
is decided. `src/domain/ledger.ts` is the only place purchases are interpreted.
Both are deliberately blind to ticket text.

## Signature discipline

```ts
evaluateRefund(facts: LedgerFacts, claim: ClaimType): RefundOutcome
```

Two parameters, and neither can carry an amount. **Never widen this signature.**
Specifically, never add:

- an `amount` or `suggested_amount` argument "for the model to propose"
- the `Ticket` itself "for context"
- a free-form `reason: string` from the model

Each of those re-opens the text-to-money path the design exists to close. If a
rule genuinely needs a new fact, derive it in `ledger.ts` from `purchases[]` and
add it to `LedgerFacts`.

## Reading purchases[] correctly

The fixture data is built to punish sentiment-reading. Internalise these:

| What the user says | What the ledger says | Correct outcome |
|---|---|---|
| "you took 249 twice" (T-1009) | one `successful` + one `failed` | **one** charge. No refund. Explain. |
| "paisa kat gaya" (T-1005) | renewal is `initiated` | money never moved. No refund. Unstick the payment. |
| feature request (T-1007) | last renewal `failed` | user is lapsed and does not know. Surface it. |
| "refund or 1 star" (T-1012) | decided on ledger alone | threat is not an input |

**`status === 'successful'` is the only state where money moved.** `initiated`
and `failed` are not charges, however sincerely the user believes otherwise.
A bank SMS for a failed attempt looks identical to one for a capture.

A duplicate requires **two captures** of the same amount inside
`DUPLICATE_WINDOW_HOURS`. A failure beside a capture is never a duplicate.

## Adding or changing a rule

Rules are ordered data in `RULES`; first match wins. To change policy, edit a
row — do not scatter conditions into other layers.

Checklist for any new rule:

- [ ] `id` is `R<n>_SCREAMING_SNAKE` and appears in the response as `rule_id`,
      so a 3am reader knows which row moved the money
- [ ] `when` reads only `LedgerFacts` and `ClaimType`
- [ ] `amount_inr` is read from a `Purchase` in `facts.captured`, never computed
      from a plan price or a number in the ticket
- [ ] `basis` records the ids and numbers the rule relied on — it is the audit trail
- [ ] placed at the right **position**; ordering is the logic. Safety rules
      (`R0_FRAUD_TO_HUMAN`) stay first.
- [ ] a test in `test/refund-gate.test.ts` covers it, plus the all-tickets ×
      all-claims invariant still passes

## Rules that must not be softened

- **Fraud never auto-refunds** (`R0`). A refund closes the ticket and destroys
  the investigation path an elder-fraud report actually needs. It goes to a human.
- **`assertSpendable` throws.** A 500 is cheaper than money leaving on a bad
  rule. Do not convert it to a warning, a clamp, or a log line.

## Failure direction

When the rules do not anticipate a legitimate case, the outcome is
`hold_for_human` — not a guessed refund. The system fails toward a person,
never toward a payout. Preserve that direction in every new rule.

## Numbers that are ours, not the brief's

`REMORSE_WINDOW_HOURS = 72`, `REMORSE_MAX_APP_OPENS = 3`. Chosen, not given —
see `docs/decisions.md` D3. If you change them, update D3 and the README table,
because several fixture outcomes move with them.

## Related

`dhaba-triage` (index) · `llm-boundary` (where ClaimType comes from) ·
`testing-practice` (the invariant tests)
