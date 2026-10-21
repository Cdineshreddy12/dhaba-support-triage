---
name: testing-practice
description: Test conventions for the Dhaba triage service - Vitest, test/ directory. Load before writing or changing a test, reviewing a test an agent produced, or deciding whether a behaviour needs coverage. Includes the "test that asserts nothing" failure mode the assignment brief calls out by name.
---

# Testing practice

`npm test` runs Vitest once. CI runs it with **no API key**, which is what keeps
replay mode honest.

## Tests assert behaviour, not shape

The brief names "a test that asserted nothing" as a thing agents produce. It is
the most common failure in generated tests. Recognise these:

```ts
// asserts nothing — passes if the gate returns literally any object
expect(outcome).toBeDefined();
expect(outcome).toBeTruthy();
expect(typeof outcome.amount_inr).toBe('number');

// asserts nothing — the mock is the only thing under test
mockGate.mockReturnValue({ amount_inr: 249 });
expect(result.refund.amount_inr).toBe(249);

// asserts nothing useful — snapshot written from current behaviour,
// so it will happily record a bug as the expectation
expect(outcome).toMatchSnapshot();
```

Each of these goes green when the logic is wrong. A test earns its place only if
you can name the bug it would catch. **Write that bug in the `it(...)` string.**

```ts
it('T-1009 duplicate claim against a single capture pays nothing', ...)
```

tells a reader what breaks. `it('works correctly')` does not.

## Never mock the gate or the ledger

They are pure functions over data — mocking them tests the mock. Mock exactly
one thing: the model provider, and prefer the replay provider over a mock even
then, because it is the code path the evaluator runs.

## The invariant tests carry the most weight

Per-ticket assertions prove today's twelve cases. Invariant tests prove
properties that hold for inputs we have not seen, and they are what survives a
policy change:

- every ticket × every `ClaimType` → amount never exceeds `captured_total_inr`
- every ticket × every `ClaimType` on T-1003 → never a payout
- a refund amount always equals some `Purchase.amount_inr` in `facts.captured`
- the same ticket twice → identical decision, second one flagged as replay

When adding a rule, add it to the per-case tests **and** check the invariants
still hold. If an invariant has to be relaxed to make a rule pass, the rule is
wrong — that is the invariant doing its job.

## The adversarial test pattern

For anything security-shaped, prove the property by **removing the attack and
asserting the output is unchanged**:

```ts
// the threat is not an input to the decision
expect(gate(politeVersion)).toEqual(gate(threateningVersion));
```

This is stronger than asserting the threatening version happens to return the
value you expected, because it keeps holding when the policy changes.

## Fixtures

`fixtures/dhaba_tickets.json` is the real data, parsed through `Ticket.parse`
in tests. Parsing it *is* a test — it catches schema drift against the actual
file rather than against a hand-written sample.

Build variant tickets by spreading a real one (`{...byId('T-1012'), body: '...'}`)
so only the thing under test differs.

## Before calling a change done

```bash
npm run typecheck && npm test
```

Both, every time. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
catch a class of bug that tests will not.

## Related

`dhaba-triage` (index) · `money-gate` (invariants) · `llm-boundary` (replay mode)
