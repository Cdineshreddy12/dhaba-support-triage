# Dhaba support triage

Triage service behind a support inbox. `POST /triage` takes a ticket and returns
a decision a support tool can act on. TypeScript · Fastify · Zod · Vitest.

## Read this first

**Load the `dhaba-triage` skill before writing or changing code.** It is the
architecture index and routes to the right convention skill for the layer being
touched. Full list: [`.claude/skills/README.md`](.claude/skills/README.md).

## The invariant everything rests on

Ticket text and money decisions are separated by a type boundary. A support
ticket is attacker-controlled input — two of the twelve fixture tickets contain
instructions aimed at the assistant — so no string a user writes can become a
rupee amount:

```
body ──► model ──► ClaimType (1 of 8 tokens) ──┐
                                               ├──► evaluateRefund ──► amount
purchases[] ──► deriveLedger ──► LedgerFacts ──┘
```

`evaluateRefund(facts, claim)` has no parameter that can carry an amount.
`src/domain/ledger.ts` and `src/domain/refund-policy.ts` must never read
`subject` or `body`.

## Commands

```bash
npm install
npm test            # vitest, runs with no API key
npm run typecheck   # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm run dev         # fastify on $PORT (default 3000)
npm run triage:all  # all 12 fixture tickets -> results table
```

`TRIAGE_MODE=replay` is the default: no network, no key, recorded model
responses from `fixtures/replay/`. CI runs this way deliberately — if replay
breaks, CI goes red.

## Two rules that bite

- **Never log `subject` or `body`.** T-1010 carries a company name and a GSTIN
  in its body. See the `observability` skill.
- **No AI co-author trailer on commits**, and the author email must be the
  GitHub noreply address. See the `git-workflow` skill.

## Where reasoning lives

- `docs/decisions.md` — choices that were not forced, so they can be argued with
- `docs/ai-log.md` — what agents produced and what was corrected. **Must be true.**
