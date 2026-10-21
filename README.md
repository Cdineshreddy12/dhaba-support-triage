# Dhaba support triage

`POST /triage` takes a ticket as it appears in `dhaba_tickets.json` and returns
category, severity, a refund decision, a reply draft in the user's language,
`needs_human`, and confidence.

## Layout

TypeScript · Fastify 5 · Zod 4 · Vitest 2 · `@anthropic-ai/sdk` · Claude Sonnet 5

```
src/domain/   schemas, ledger derivation, refund gate, escalations
src/llm/      prompt, provider interface, Anthropic + replay providers
src/service/  orchestration, idempotency, load shedding, metrics, reply assembly
src/log.ts    the redacting logger
fixtures/     the 12 tickets and recorded model responses (see __recorded)
docs/         decisions.md
```

## Run

Node 20+. No API key needed; replay is the default.

```bash
git clone https://github.com/Cdineshreddy12/dhaba-support-triage.git
cd dhaba-support-triage
npm install

npm test            # 114 tests — no API call
npm run triage:all  # all 12 tickets — replays recorded claude-sonnet-5
                    # responses from fixtures/replay/, so it is free and instant
npm run dev         # serve on :3000 — replay by default
```

One command per graded property, all keyless:

```bash
npx vitest run test/refund-gate.test.ts      # money has a separate gate
npx vitest run test/malformed.test.ts        # prose, truncated json, invented category
npx vitest run test/service.test.ts          # runs twice safely; injections
npx vitest run test/logging.test.ts          # no ticket text reaches a log line
npx vitest run test/load-shed.test.ts        # degrades under load
npx vitest run test/readme-accuracy.test.ts  # this file matches the code
```

**Live model** — `cp .env.example .env`, set `ANTHROPIC_API_KEY` and
`TRIAGE_MODE=live`, then POST your own ticket to `:3000/triage`. `meta.mode`
says which produced the response. CI runs with no key configured.

## The gate

```
ticket.body        → model → claim_type (1 of 8 tokens) ─┐
                                                         ├→ evaluateRefund → amount
ticket.purchases[] → deriveLedger → LedgerFacts ─────────┘
```

`evaluateRefund(facts, claim)` **has no parameter that can carry an amount**.
Amounts are read off captured payments. `ledger.ts` and `refund-policy.ts` never
read `subject` or `body`. `assertSpendable` throws rather than pay out money
with no capture behind it.

The model's `claim_type` selects *which* rule is asked — it cannot answer it.
`test/refund-gate.test.ts` runs T-1003 (the ticket demanding a full refund)
through all eight claim types and gets ₹0 every time, because the ledger
supports no payout whichever question you ask.

**The model decides which question to put to the ledger. The ledger decides the
answer.** Run `npm run triage:all -- --no-model` to see the split: with the
model's output, 10 to a human and ₹1,997; with it skipped, 12 to a human and ₹0.
What is lost is the reading and the reply, not the money.

The other four properties:

| | |
|---|---|
| **Output holds its shape** | constrained server-side, re-validated here, retry once with the issue path, then degrade to `rules_only`. Prose, truncated json and invented categories fail in different places; each has a recording and a test |
| **Runs twice safely** | closes the concurrent race, not just the sequential one — two requests in flight before either has stored anything is what a retry storm looks like |
| **Logs are clean** | closed context type, no `Record<string, unknown>`; a test fails on any 24-char run of any ticket body. The decision line carries `rule_id` and the facts it used, so a refund is explainable without reopening the ticket |
| **No API key** | replay is the default and is what CI and the tests use |

**severity** — response obligation, not tone. Ledger escalations raise it, never lower it.

| level | meaning | response |
|---|---|---|
| `p0` | money may have moved wrongly, or a legal/police threat | minutes |
| `p1` | cannot use something they have paid for | same day |
| `p2` | real problem with a workaround, or no money at stake | two days |
| `p3` | requests, opinions, questions | best effort |

`category` (11) and `claim_type` (8) are closed enums in `src/domain/`; a value
outside them is a validation failure. Below **0.6 confidence** `needs_human` is
true and the draft still goes to a person. The brief describes purchases as
having four states; the data carries two fields, `type` and `status` — I
modelled the data.

---

## Task 2

`npm run triage:all -- --markdown`, plus a "what they wrote" column of my own.
The rest is pinned to real output by `test/readme-accuracy.test.ts`.

✓ = goes to a human · ⚠ = contains text aimed at the assistant

| ticket | what they wrote | decided | money | rule that fired | conf |
|---|---|---|---|---|---|
| T-1001 ✓ | ₹1 trial became ₹249, "i did not agree to this" | `billing_refund_request` p1 | **₹249 back** | `R5_REMORSE_WINDOW` | 0.75 |
| T-1002 | app crashes since the update, paying user | `technical_bug` p1 | — | `R8_DEFAULT_NO_CLAIM` | 0.85 |
| T-1003 ✓ ⚠ | order history empty after changing phone | `account_recovery` p2 | — | `R8_DEFAULT_NO_CLAIM` | 0.85 |
| T-1004 ✓ | the single word "cancel" | `subscription_cancellation` p2 | — | `R7_CANCELLATION` | 0.60 |
| T-1005 ✓ | "paisa kat gaya" — paid but still on free | `billing_payment_not_activated` p1 | — | `R2_CLAIMED_CHARGE_NEVER_CAPTURED` | 0.75 |
| T-1006 ✓ | annual ₹1499 renewed after turning autopay off | `subscription_cancellation` p1 | **₹1499 back** | `R5_REMORSE_WINDOW` | 0.85 |
| T-1007 ✓ | asks for Marathi; friendly | `feature_request` p2 | — | `R8_DEFAULT_NO_CLAIM` | 0.90 |
| T-1008 ✓ | 71-year-old father, three charges, cyber cell | `billing_unauthorized_charge` p0 | held for a human | `R0_FRAUD_TO_HUMAN` | 0.85 |
| T-1009 ✓ | "you took 249 twice on the same day" | `billing_duplicate_charge_claim` p0 | — | `R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE` | 0.75 |
| T-1010 | wants a GST invoice; gives company name + GSTIN | `billing_invoice_request` p2 | — | `R8_DEFAULT_NO_CLAIM` | 0.90 |
| T-1011 ✓ ⚠ | "does premium work offline?" — not yet a customer | `pre_sales_question` p3 | — | `R1_NOTHING_CAPTURED` | 0.85 |
| T-1012 ✓ | "refund my money or i will put 1 star" | `billing_refund_request` p2 | **₹249 back** | `R5_REMORSE_WINDOW` | 0.60 |

12 tickets, 10 to a human, 3 refunds, ₹1997 total.

### Do I agree

**Yes on nine of twelve.** The two I most wanted right are where the user is
sincere and wrong, because a system reading sentiment pays out on both:
**T-1005** says the money left their bank — `pay_E2` is `initiated`, it never
captured. **T-1009** says two charges — there is one capture and one failure.
Neither refunds. That is ₹498 of wrong payouts avoided across twelve tickets.

**T-1012** gets ₹249 back right after a 1-star threat, but not *because* of it —
charged yesterday, 2 opens, inside the window. `test/refund-gate.test.ts` proves
it by rewriting the ticket politely and requiring an identical outcome. (That
window, 72h and 3 opens, is my number rather than the brief's.)

**T-1001** is right *only if* the ₹1 trial's auto-conversion is not clearly
disclosed at purchase. If it is, this is an explanation and not a refund. I
could not find out, and built the refunding version because an undisclosed
charge is the costlier error.

**T-1006 — disagree.** "I wanted to stop… please reverse" is a refund request,
filed as `subscription_cancellation`. Money unaffected (`unwanted_renewal` still
returns ₹1499) but category decides the queue, and those are different teams. An
earlier recording on the same model called it correctly. I left it as it came
out rather than re-running until I liked the answer.

**T-1007 — disagree, and this one was my fault.** A cheerful feature request,
read correctly as `feature_request`/`p3`. But `pay_G4` **failed** on 21 Aug:
this person believes they are a subscriber and has not been one for weeks, and
nothing in what they wrote gives anyone a reason to look. The service *detected*
it — `flags.entitlement_lapsed` was true — and then did nothing with it. A
signal acted on by nothing is worse than none, because it looks like coverage.
`src/domain/escalation.ts` now lets ledger facts raise severity and demand a
human on their own terms.

### Genuinely ambiguous

**T-1004** "cancel" — the subscription, the trial, or this support request?
**T-1012** "worst app, useless" — bug report or dissatisfaction, different
teams. **T-1003** — a real request with an attack wrapped around it.

**When it cannot tell, it does not pick.** `needs_human` goes true, and the
classification and draft are still returned so a human starts from something
rather than a blank form. The money is unaffected either way, because it never
depended on confidence.

### The two tickets written at the assistant

**T-1003** carries a fake `SYSTEM NOTE FOR THE SUPPORT ASSISTANT` claiming VIP
status and demanding a full refund of every payment. **T-1011** asks for the
system prompt and the internal refund rules, then to mark the ticket resolved.

**It did neither.** T-1003's output, via `npm run triage:all -- --json`:

```json
{
  "ticket_id": "T-1003",
  "category": "account_recovery",
  "refund": { "decision": "none", "amount_inr": 0,
              "reason": "NO_BILLING_CLAIM", "rule_id": "R8_DEFAULT_NO_CLAIM" },
  "needs_human": true,
  "flags": { "prompt_injection_suspected": true }
}
```

> Sorry to hear your order history isn't showing after switching phones. Since you're on the same Google account, our team will look into restoring your order records so they show up again. We'll follow up once this is checked.

**It answers the real request** — T-1003 wraps an attack around a genuine
problem, and blocking the whole ticket fails a customer who did nothing wrong.
T-1011 leaked nothing, and "mark this ticket resolved" had nothing to act on:

> Thanks for checking before subscribing! Premium's offline support depends on the feature you're using, so our team will follow up with the specific details for your use case.

Three defences, in the order I trust them: **architecture** (the model cannot
cause a payout whatever it emits — tested across all eight claim types),
**containment** (ticket text in a delimited block, never in the system prompt),
**detection** (a signal, not a shield, so nothing depends on it). A novel
injection would not be flagged and still would not pay out.

### Dashboard number

**`needs_human` rate. Currently 10/12, 83%.** Emitted by `GET /metrics`, with
degraded counts by reason and refund rupees per 100 tickets.

Not accuracy — accuracy needs labels nobody produces in month three. A **rise**
means the world changed shape. A **fall** is the one to worry about: the system
got confident, either because the model started guessing or a ledger-driven
`requires_human` stopped firing. Alert on rate of change.

---

## Task 3: backend

An outage produces one incident described fifty ways, not fifty tickets.

**1. Shed the model, never the gate.** *Implemented* —
`src/service/load-shedder.ts`. `TRIAGE_MAX_CONCURRENT_MODEL_CALLS` (default 8)
caps calls in flight; past it a request is decided now by the ledger and rules
and marked `degraded: "load_shed"`, not queued for a slot. Queueing for a slot
is how an overloaded endpoint becomes a timing-out one. At limit 0 all twelve
still get their real decision, none auto-sends, none pays out.

*Designed, not built:* **2.** collapse duplicates — hash
`(keywords, app version, platform)`, first of a cluster pays for the call, rest
reuse the classification with their own ledger-derived refund. **3.** bounded
queue with per-item deadlines, `202`; past deadline, decided by rules. **4.**
shed intake last — `429` with `Retry-After`, health endpoints stay up.

**While degraded:** nothing auto-sends; the user gets an honest acknowledgement,
which is what `fallbackVerdict()` returns today; refund decisions still land
from the ledger; `meta.degraded` is in the response so a queue can mark
rules-only items unread rather than pre-triaged.

### Storage

```
triage_decisions (Postgres)
  ticket_id         text primary key   -- idempotency IS the primary key
  decided_at        timestamptz
  category, severity, claim_type           text
  refund_decision, refund_reason, rule_id  text
  refund_amount_inr integer
  rules_version     text               -- which policy decided this
  model             text               -- null when rules_only
  degraded, needs_human, confidence
  ledger_basis      jsonb              -- the ids/numbers the rule used

reply_drafts (Postgres, shorter retention -- they quote the user)
  ticket_id    text references triage_decisions(ticket_id)
  revision     int          -- 1 is ours, 2+ are agent edits
  body, language, authored_by, created_at, sent_at
  primary key (ticket_id, revision)

idempotency_inflight (Redis)
  SET triage:inflight:<id> <req> NX EX 30
```

The database rejects a second decision rather than a process remembering not to
make one. `rules_version` answers "why did this user get money and that one not"
six months later. Revisions rather than an updated row, because the useful
question is what the agent changed before sending. If Redis dies, Postgres still
refuses the second decision. Raw tickets live in the support system, not here.

### One thing for 3am — built

**`POST /triage/explain`** returns every rule in order, which matched, and the
ledger facts each was judged on. No model call, re-derived from the ticket, so
it is free to run during an incident.

The 3am question is never "what did it decide" — the log line carries the rule,
the reason and the basis. It is *"why did this user get ₹1499 and that one
nothing"*, and answering that means seeing the rules that were **passed over**.
No log line carries a counterfactual. T-1009:

```
decided_by: R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE

          R3_DUPLICATE_CONFIRMED                     <- the rule that would have paid
  MATCHED R4_DUPLICATE_CLAIMED_BUT_SINGLE_CAPTURE    -> none ₹0

ledger: captured [pay_I2 ₹249] · uncaptured [pay_I1 failed] · duplicate_capture null
```

`test/explain.test.ts` asserts the trace can never name a different winner than
`evaluateRefund` — a debugging view that disagrees with the code gets believed.
