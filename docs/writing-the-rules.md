# Writing the refund rules

The rule table in `src/domain/refund-policy.ts` is stubbed on this branch. Each
entry carries its intent, the tickets it governs, and the test that pins it.

## How to work

```bash
npm test -- --watch        # leave running
```

Write one rule, watch its tests go green, move to the next. Order matters —
first match wins, so `R0` must stay first and `R8` must stay last.

## The shape

```ts
{
  id: 'R1_NOTHING_CAPTURED',
  when: (f, claim) => f.captured_total_inr === 0,
  then: () => ({
    decision: 'none',
    amount_inr: 0,
    reason: 'NO_CAPTURED_PAYMENT',
    requires_human: false,
    basis: { captured_count: 0 },
  }),
}
```

`when` gets `(facts: LedgerFacts, claim: ClaimType)` — use `_f` or `_claim` for
the one you do not need. `then` gets `(facts)` and returns everything except
`rule_id`, which `evaluateRefund` adds.

## What `LedgerFacts` gives you

Read the interface in `src/domain/ledger.ts`. The ones the rules need:

| field | meaning |
|---|---|
| `captured` | payments where money actually moved |
| `captured_total_inr` | sum of those |
| `last_capture` | the most recent one, or `null` |
| `hours_since_last_capture` | against the ticket's `received_at`, or `null` |
| `uncaptured` | `initiated` + `failed` attempts |
| `claimed_charge_is_uncaptured` | latest attempt did not capture |
| `duplicate_capture` | two captures, same amount, within the window |
| `app_opens_since_renewal` | usage since the charge |

## Three rules that are not negotiable

1. `when` reads only `LedgerFacts` and `ClaimType`. If you reach for the ticket,
   the design has been broken.
2. `amount_inr` comes off a `Purchase` in `facts.captured`. Never a plan price,
   never a literal, never arithmetic. `assertSpendable` throws otherwise.
3. If an invariant test has to be relaxed to make a rule pass, the rule is
   wrong. That is the invariant doing its job.

## When it is green

```bash
npm run typecheck && npm test && npm run triage:all
```

The table should match the README's. Then delete the `TODO` helper at the bottom
of the file — it should have no callers left.
