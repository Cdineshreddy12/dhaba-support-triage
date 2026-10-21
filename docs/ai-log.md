# AI usage log

Written as I go, not reconstructed at the end. Each entry is a thing an agent
produced, what I did with it, and the commit it landed in. Task 4 of the brief
is assembled from this file.

Format:
- **what I asked for** - the intent, not the full prompt
- **what came back** - verbatim where it matters
- **verdict** - kept / corrected / rejected, and why
- **commit** - SHA once it lands

---
## 2026-10-21 — `zodOutputFormat` against the wrong Zod major

**what I asked for:** the Anthropic provider, using the SDK's structured-output
helper so the model is schema-constrained server-side.

**what came back:** code that reads exactly right and does not compile.

```ts
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
output_config: { format: zodOutputFormat(ModelVerdict) }
```

The call is correct. The problem was underneath it: `package.json` pinned
`zod@^3.24`, and SDK 0.137's helper is typed against Zod **4** internals
(`$ZodTypeInternals`). Every import resolved, the editor autocompleted, and
`tsc` rejected it with a type error that names neither zod nor the version.

**how it was caught:** `npm run typecheck` in the same step as writing the file.
Nothing in the source text looks wrong — reading harder would not have found it.

**verdict:** corrected. Moved to `zod@^4` and fixed the two v3→v4 API
differences the schemas actually used:

- `z.string().datetime({offset:true})` → `z.iso.datetime({offset:true})`
- `z.record(valueType)` → `z.record(keyType, valueType)`

Then a second, smaller instance of the same class of error: a hand-written
`issueSummary(error: { issues: Array<{path: Array<string|number>}> })` — a
plausible structural type for a Zod error that is wrong in v4, where `path` is
`PropertyKey[]` and may contain symbols. Replaced with `z.ZodError` and
`.map(String)`.

**what this changes about how I work:** the lesson is not "check versions". It
is that a *type error in a dependency boundary* is the one failure an agent
cannot see by re-reading its own output, because the output is correct in
isolation. Typecheck has to run on every file, not at the end of the session.

**commit:** see `feat: anthropic provider` below.
## 2026-10-21 — the model affirmed money movement the ledger denies

**what I asked for:** classify all twelve tickets and draft replies, with the
billing facts supplied as trustworthy context.

**what came back:** T-1005 (Hinglish, "paisa kat gaya par plan activate nahi
hua"), opening line, verbatim:

> Bhai, samajh gaya — payment bank se kat gaya hai lekin app abhi bhi free
> version dikha raha hai.

"payment bank se kat gaya hai" = "the payment HAS been deducted from your bank."
Stated as established fact, in our voice.

It has not. `pay_E2` has status `initiated` — the charge was never captured.
The model was handed `latest_attempt_status: "initiated"` and
`captured_payment_count: 1` (the Rs 1 trial) in the same prompt, and still
restated the user's claim back to them as confirmed.

**why it is easy to miss:** the reply is excellent on every axis a reviewer
checks first. Correct language, correct register ("Bhai, samajh gaya"), correct
category, correct claim type, 0.84 confidence, and a sensible next step. The
defect is one clause of one sentence, in Hinglish, and it contradicts a JSON
field rather than anything in the ticket. Reading the output as prose will not
surface it; it only appears when you read the reply against the ledger.

**the actual cost:** we would have told a user we had verified a charge that
does not exist. They stop chasing their bank, which is the only party that can
actually explain a pending UPI mandate — and we created that belief ourselves.

**a second, smaller one in the same batch:** T-1004 and T-1003 both wrote "I've
passed this to the billing team" / "I've passed this to our accounts team" —
claiming a completed action, which the prompt explicitly forbids ("Never claim
an action has already been taken"). The rule was present and was not followed.
A flat prohibition with no alternative phrasing offered is weak instruction: the
model needed to say *something* about what happens next, and the only shape it
had was the forbidden one.

**verdict:** corrected in the prompt, not in post-processing — a filter on the
output would catch the phrasing while leaving the belief that produced it.
Re-recorded and diffed. See the following commit.
