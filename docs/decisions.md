# Decisions

Short records of choices that were not forced, so they can be argued with.
The brief says a decision written down is fine; a silent guess is not.

---
## D1 — purchase `type` and `status` are two fields, not one set of four states

The brief says purchases "are in one of four states: initiated, failed,
successful, renewal". `dhaba_tickets.json` carries two independent fields:
`type` in {trial, renewal} and `status` in {initiated, failed, successful}.
"renewal" is a type; the other three are statuses.

**Decision:** model the data, since the service has to parse the data. Asked the
team to confirm. If the intent was a single four-valued state machine, only
`src/domain/ticket.ts` changes; the ledger reads through accessors.

## D2 — the model may not name a rupee amount

`evaluateRefund(facts, claim)` takes derived ledger facts and one constrained
`ClaimType`. There is no parameter through which a model could pass an amount,
and `assertSpendable` throws if a rule ever returns money not matching a
captured payment.

**Why this line:** every other split I considered left a text-to-money path
open. Letting the model propose an amount for a human to approve still lets a
crafted ticket set the anchor a tired reviewer approves at 3am.

**Cost, stated honestly:** a legitimate case the rules do not anticipate gets
`hold_for_human` instead of the right refund. That is the direction I want the
failure to point.

## D3 — the remorse window is 72h and 3 app opens

Not given in the brief, so I picked numbers and wrote them down. 72h covers the
Rs 1 trial converting at ~24h (T-1001) and a same-day annual renewal (T-1006).
"3 opens" distinguishes looking at the app from using it.

**Open question for the team:** is the trial's 24h auto-conversion disclosed at
purchase? If it is, T-1001 is an explanation rather than a refund, and R5 should
exclude `trial_conversion_surprise`. Built the refunding version because an
undisclosed charge is the more expensive error.
