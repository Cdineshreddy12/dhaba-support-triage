---
name: observability
description: Logging, redaction, and debuggability rules for the Dhaba triage service - src/log.ts and every log call. Load before adding any log line, choosing what to put in an error body, adding metrics, or working on the "debugging this at 3am" part of the backend track. The brief grades this: nothing identifying a person or company may reach a log line.
---

# Logs that are safe to read

The brief is explicit: *"nothing in these tickets that identifies a person or a
company should end up in a log line."* This is graded, and the fixture data
contains a live test of it.

## The thing that will catch you out

Ticket **T-1010** body:

```
please share gst invoice for my annual payment, need it for reimbursement.
company name and gstin below.
Acme Interiors, 29ABCDE1234F1Z5
```

A company name and a GSTIN, in free text, in the body. Any log line that
includes a ticket body leaks both. There is also a device string in T-1002
(`redmi note 12, android 13`) and a family detail in T-1008.

**Therefore: never log `subject` or `body`. Not at debug level. Not in an error
object. Not in a stack trace's captured context. Not in a "just while I'm
debugging" line that gets committed.**

## What is safe to log

| Safe | Not safe |
|---|---|
| `ticket_id` (`T-1001`) | subject, body, any substring of them |
| `payment_id` (`pay_A2`) | names, GSTINs, emails, phone numbers |
| amounts, counts, hours | the model's `reply_body` (quotes the user) |
| `rule_id`, `reason` codes | the model's `summary` (paraphrases the user) |
| `category`, `severity`, `claim_type` | raw model output on a parse failure |
| `mode`, `degraded`, attempt counts | Zod issue *values* (echo paths only) |

The last two rows are the easy mistakes. When model output fails to parse, the
instinct is to log the raw string so you can see what happened — but that string
contains a paraphrase of the ticket. Log the **length, the parse error, and the
first validation issue path**; keep the raw payload out, or route it to a
separate store with its own retention if one ever exists.

## Mechanism, not discipline

Redaction must be enforced by `src/log.ts`, not by remembering. The logger
accepts a narrow, typed context object — ids, enums, numbers, booleans. There is
no `extra: Record<string, unknown>` escape hatch, because that is where a body
eventually gets passed.

If you need a new field in logs, add it to the typed context so the decision is
reviewed once, in one place.

## Correlation — the 3am requirement

Every line carries `request_id` and `ticket_id`. One triage decision is
reconstructable from logs alone: what mode it ran in, how many model attempts
happened, whether it degraded and why, which rule fired, what the amount was,
and whether it was an idempotent replay.

The test of this: *could you explain why a specific user got money back, from
logs, without opening the ticket?* `rule_id` plus `basis` is what makes that
yes. That is also the single highest-value thing to add for debuggability — the
decision is recorded, not just the outcome.

## Metrics worth having

The brief asks for one number for a dashboard. Candidates, in order of how much
they tell you next month:

1. **`hold_for_human` rate** — rises when the world changes shape and the rules
   stop fitting. A silent fall is worse news: rules firing confidently on cases
   they should not.
2. `degraded` rate by reason — model health, separable from triage quality.
3. Schema-rejection rate on model output — moves when a provider or prompt changes.
4. Refund amount per 100 tickets — the money line; alerts on a policy mistake.

Pick one for the README and say why the alternatives tell you less.

## Related

`dhaba-triage` (index) · `api-contracts` (error bodies) · `llm-boundary`
(what not to log on a parse failure)
