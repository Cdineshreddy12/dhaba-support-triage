---
name: dhaba-triage
description: Index and architecture map for the Dhaba support-triage service. Load FIRST before writing or changing any code in this repo - it routes to the specific convention skill for the layer you are touching and states the invariants that hold across all of them. Triggers on any work in this repository: adding an endpoint, changing triage behaviour, touching refund logic, editing prompts, adding tests, or writing a commit.
---

# Dhaba support triage — architecture index

A triage service behind a support inbox. One endpoint, `POST /triage`, takes a
ticket and returns a decision a support tool can act on. Built for the Propel
full-stack AI engineer assignment; the grading criteria are in
`~/Downloads/Propel_Full_Stack_AI_Engineer_Assignment.pdf`.

## The one idea the whole design turns on

**Ticket text and money decisions are separated by a type boundary.**

A support ticket is attacker-controlled input. Two of the twelve fixture tickets
contain text addressed to the assistant rather than to support. So the system is
arranged such that no string a user writes can become a rupee amount:

```
ticket.body ──► model ──► ClaimType (one of 8 tokens)  ──┐
                                                         ├──► evaluateRefund ──► amount
ticket.purchases[] ──► deriveLedger ──► LedgerFacts ─────┘
```

`evaluateRefund(facts, claim)` has **no parameter** through which an amount can
be passed. Amounts are read out of captured payments. This is not a convention
to be polite about — it is the thing being graded.

## Layer map

| Layer | Path | Knows about ticket text? | Skill |
|---|---|---|---|
| Input contract | `src/domain/ticket.ts` | parses it | `api-contracts` |
| Ledger facts | `src/domain/ledger.ts` | **no** | `money-gate` |
| Refund gate | `src/domain/refund-policy.ts` | **no** | `money-gate` |
| Output contract | `src/domain/triage.ts` | — | `api-contracts` |
| Model boundary | `src/llm/` | yes, untrusted | `llm-boundary` |
| Orchestration | `src/service/` | yes | `llm-boundary` |
| Transport | `src/server.ts` | yes | `api-contracts` |
| Logging | `src/log.ts` | **must redact** | `observability` |

## Invariants — do not break these without changing the README

1. **No text-to-money path.** `src/domain/ledger.ts` and
   `src/domain/refund-policy.ts` must never import, receive, or read
   `subject` or `body`. If a change needs them to, the change is wrong.
2. **Every rupee traces to a capture.** `assertSpendable` throws rather than
   paying out an amount with no matching captured payment. Never soften it to a log line.
3. **The output shape always holds.** A caller gets a schema-valid
   `TriageResponse` or a non-200. Never a half-filled object.
4. **Same ticket id, same decision.** Re-POSTing a ticket returns the stored
   decision with `meta.idempotent_replay: true`. It must not refund twice.
5. **Logs carry no person or company.** Ids and numbers only. See `observability`.
6. **It runs with no API key.** `TRIAGE_MODE=replay` is the default and is what
   CI runs. If replay breaks, CI goes red — that is deliberate.

## Where decisions live

- `docs/decisions.md` — choices that were not forced, written down so they can
  be argued with. The brief: *"a decision you made and wrote down is fine;
  guessing silently is the thing we're watching for."*
- `docs/ai-log.md` — what agents produced and what was corrected. Task 4 is
  assembled from it. **It must be true.** Never record a hand-written claim for
  code an agent generated.

## Related skills

`money-gate` · `llm-boundary` · `api-contracts` · `observability` ·
`testing-practice` · `git-workflow`
