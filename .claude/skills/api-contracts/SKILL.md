---
name: api-contracts
description: Zod schema and Fastify route conventions for the Dhaba triage service - src/domain/*.ts and src/server.ts. Load before adding or changing an endpoint, editing any Zod schema, changing the request or response shape, adding an enum value, or deciding what status code a failure returns.
---

# API contracts

Zod schemas are the contract at both edges. TypeScript types are derived from
them with `z.infer`, never declared separately — a hand-written interface beside
a schema is two sources of truth that will drift.

## Schema conventions

- **One schema per concept**, exported with its inferred type under the same
  name: `export const Ticket = z.object({...}); export type Ticket = z.infer<typeof Ticket>;`
- **Enums are closed.** `z.enum([...])` everywhere a small vocabulary exists.
  Never `z.string()` for a category, status, severity, or reason code. A value
  outside the list is a validation failure, not a new value.
- **Enum source of truth is the domain**, not the schema. `REFUND_REASONS` and
  `CLAIM_TYPES` are `as const` arrays in `refund-policy.ts`; the schema spreads
  them. Adding a reason in one place adds it everywhere.
- **Parse at the edge, trust inside.** Inbound tickets are parsed once in the
  route; model output is parsed once at the model boundary. Nothing downstream
  re-validates or defensively checks fields.
- **No `.passthrough()`, no `.catchall()`** on inbound shapes. Unknown keys from
  a user are not forwarded into the system.
- **No `.default()` on anything that affects a decision.** A missing field
  should fail loudly, not quietly become a value that moves money.

`tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`. Array indexing yields `T | undefined` — handle it
or use `!` with a reason, never silence the whole flag.

## The endpoint

`POST /triage` takes one ticket **exactly as it appears in
`dhaba_tickets.json`** — no wrapper object, no renamed fields. The brief
requires the file's own shape to work unmodified. Returns `TriageResponse`.

Supporting routes: `GET /healthz` (liveness, no dependencies) and
`GET /readyz` (reports mode and whether replay fixtures loaded).

## Status codes

| Situation | Code | Body |
|---|---|---|
| Decided (fresh or idempotent replay) | `200` | `TriageResponse` |
| Ticket fails `Ticket.parse` | `400` | error with Zod issue paths, **no field values** |
| Model unusable, rules fallback succeeded | `200` | `TriageResponse`, `meta.degraded` set |
| Shed under load | `429` | retry hint; see the backend track notes |
| Gate invariant violated (`assertSpendable` threw) | `500` | opaque error, loud log |

A `200` always carries a schema-valid body. **Never return a partially filled
response** — a caller cannot tell a missing field from a deliberate one, and a
support tool will render it as fact.

The response is validated against `TriageResponse` before it is sent. We hold
ourselves to the contract we publish, and it catches assembly bugs in tests.

## Error bodies

Validation errors report **paths, not values**: `purchases.0.status` is fine,
the rejected string is not — it may be user text, and it would land in a log.
See `observability`.

## Versioning the shape

Additive changes only on a live shape: new optional fields are fine, renames and
removals are not. If the shape must break, that is a `docs/decisions.md` entry
and a README update, because the README's result table is generated from it.

## Related

`dhaba-triage` (index) · `money-gate` (RefundResult) · `llm-boundary`
(ModelVerdict) · `observability` (what may appear in an error body)
