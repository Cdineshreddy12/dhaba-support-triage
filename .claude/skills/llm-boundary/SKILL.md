---
name: llm-boundary
description: How the Dhaba triage service talks to a model and distrusts what comes back - src/llm/ and src/service/. Load before writing or editing a prompt, adding a provider, changing retry or fallback behaviour, handling malformed model output, or working on prompt-injection defence. Also load when a ticket produces a wrong category or the service degrades unexpectedly.
---

# The model boundary

The model is a classifier with a vocabulary, not an authority. Everything it
returns is untrusted input that has to survive `ModelVerdict.parse()` before any
other code sees it.

## What the model may and may not do

**May:** pick a `category`, pick a `severity`, pick a `claim_type`, detect the
user's language, write empathetic prose, flag an injection, state a confidence.

**May not — structurally, not by instruction:**

- name a rupee amount (`ModelVerdict` has no amount field)
- decide a refund (`claim_type` is an input to the gate, not a verdict)
- invent a category or severity (closed Zod enums reject it)
- assert an outcome in the reply (`reply_body` is empathy only; the service
  appends the money sentence from the gate's `RefundOutcome`)

If a prompt change would require widening `ModelVerdict`, stop — that is the
boundary moving, and it needs a `docs/decisions.md` entry.

## The validate → retry → degrade path

This must be a real code path with tests, not a comment. Order:

1. **Parse.** `ModelVerdict.safeParse(JSON.parse(raw))`. Both can throw; both
   are the same failure class — unusable output.
2. **Retry once**, with the validation error fed back as a correction turn.
   One retry, not a loop: a model that returned prose twice will return it again,
   and tickets have a latency budget.
3. **Degrade deterministically.** Fall back to `rules_only`: the ledger and the
   gate still work without any model, so the caller gets a real refund decision,
   a conservative category, `needs_human: true`, and `confidence: 0`.
4. **Say so.** Set `meta.degraded` to the specific reason and `meta.mode` to
   `rules_only`. Never return degraded output that looks confident.

Degradation is **visible, never silent**. A caller must be able to tell a
model-derived answer from a fallback one without reading logs.

## Low confidence is a routing decision

Below the confidence floor, the answer is not "guess anyway" — it is
`needs_human: true` with the draft still attached so the agent has a starting
point. The brief asks what the system does when it cannot tell; the answer is
that it says so and routes, rather than picking the likeliest label silently.

## Prompt injection

Two fixture tickets contain instructions aimed at the assistant: T-1003 (a fake
`SYSTEM NOTE` claiming VIP status and demanding a full refund) and T-1011 (asks
for the system prompt and internal refund rules).

Defence is layered, and the layers are ranked by how much they are trusted:

1. **Architecture (the real defence).** Even a fully captured model cannot cause
   a payout, because `ClaimType` is all it can emit and the gate reads the
   ledger. Test this directly: run the ticket under *every* claim type and
   assert no payout. See `test/refund-gate.test.ts`.
2. **Containment.** Ticket text goes in a clearly delimited user block, never
   concatenated into the system prompt.
3. **Detection.** `prompt_injection_suspected` on the verdict, surfaced in
   `flags`, routed to a human. Treated as a signal, not a shield.
4. **Output scanning.** A reply that would leak policy internals or confirm an
   unmade refund is a bug in the reply assembly, not something to ask the model
   nicely to avoid.

**T-1003 is the subtle one.** It wraps a *legitimate* request — restore purchase
history after a phone change — around the injection. The correct behaviour is
not to block the ticket: serve the real request, ignore the instruction, flag it.
A system that refuses T-1003 outright has failed a real user.

Never echo injected instruction text back into a reply draft or a log line.

## Providers

`src/llm/provider.ts` is the interface. Implementations are interchangeable and
chosen by `TRIAGE_MODE`:

- `replay` — reads recorded responses from `fixtures/replay/`. **Default.** No
  network, no key. This is what CI runs and what the evaluator runs.
- `live` — real API call. Requires a key.

Replay is not a test double bolted on afterwards; it is a first-class mode the
brief requires. When adding a provider, keep the fixture key stable (ticket id)
so recorded responses stay addressable.

## Prompt edits

The prompt lives in one file and is read in one place. When editing it:

- change one thing at a time, then run `npm run triage:all` and diff the table
- a prompt change that moves a fixture outcome belongs in its own commit with
  the before/after in the message
- never put policy numbers (remorse window, amounts) in the prompt — they live
  in the gate, and duplicating them means they will drift

## Related

`dhaba-triage` (index) · `money-gate` (what ClaimType feeds) ·
`observability` (what must not reach logs) · `testing-practice`
