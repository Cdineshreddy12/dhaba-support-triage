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
## 2026-10-21 — a bug reading found that no test could have

**what I asked for:** rewrite the refund rule table rule by rule against the
red tests, on a branch, rather than keep the generated version.

**what came back:** rules that passed all 58 tests. Barely different from the
generated version.

**what the pass actually surfaced:** reading `R5_REMORSE_WINDOW`'s condition —
not running it — the comparison `f.hours_since_last_capture <= 72` raised the
question of which direction time ran. It came from a `Math.abs` helper. A
capture timestamped *after* the ticket yields a small positive number, which
satisfies `<= 72`, so a charge that had not happened yet was read as fresh and
refunded in full. ~Rs 1499 on T-1006's shape.

**why no test caught it:** no fixture ticket has a capture later than its
`received_at`, and every test in the suite was written from those twelve
tickets. A suite derived from the data cannot find a case the data does not
contain. Both the generated rules and the rewritten ones were green throughout.

**verdict:** fixed. `hoursBetween` keeps `Math.abs` for spacing between events
whose order is already known; `hoursElapsed` is signed and feeds the window; R5
guards `>= 0` so the policy does not rely on the ledger behaving. Regression
test verified by reintroducing the bug and confirming it fails both assertions.

**the general point:** the two defects before this one were caught by tooling
(`tsc`) and by reading output against the ledger. This one was only reachable by
reading the code as its author. That is the argument for doing a slow pass over
the file where being wrong costs money, even when an agent's version of it
passes everything you have.

**commits:** `fc7decf` (rules), then the fix, merged as `merge: hand-written
refund rule table, and a time-comparison bug it surfaced`.
## 2026-10-21 — a model swap moved the safety routing, not the money

**what I did:** changed the runtime model from `claude-opus-5` to
`claude-sonnet-5`. No prompt change, no rule change, no test change.

**what held:** every amount. Same rules fired on all twelve, same Rs 1997, same
refusals on T-1005 and T-1009, both injections flagged. The gate reads the
ledger, so the model has no route to an amount and swapping it could not move
one.

**what moved:** `needs_human`, on two tickets.

T-1012 (the play-store threat) went from `needs_human: true` under opus to
`false` under sonnet, with confidence 0.60 against a 0.55 floor. Nothing else
caught it, so a coercion attempt auto-refunded Rs 249 unread.

T-1004 ("cancel", one word) returned exactly 0.55 against a strict `<` test and
slipped through by a hundredth.

**verdict:** the architecture protected the amount and left routing trusting the
model's own opinion of whether it should be trusted -- the same mistake as
letting a model name an amount, moved one layer up. Fixed by making a `refund`
decision always require a person, and raising the floor to 0.6.

**the general point:** the thing I had tested was "can text reach money", and
the answer stayed no. The thing I had not tested was "does safety still hold if
the model is replaced", and it did not. Swapping the model is a cheap way to
find which of your guarantees are structural and which were luck.

**commit:** `df6790e`.
## 2026-10-21 — the prompt taught the model to duplicate the service

**what I asked for:** a reply for T-1005 that does not assert a charge the
ledger does not show.

**what came back, and what was wrong with it:** the fix worked -- no false
claim -- but the assembled reply said the same thing twice:

> ...woh payment humare system mein complete nahi dikh raha, isliye free
> version hi show ho raha hai.   (model)
>
> Woh payment humare system mein incomplete dikh raha hai, matlab woh hum tak
> nahi pahuncha.   (appended by the service from the fired rule)

The cause was my own earlier fix. To stop the model claiming the money was
deducted I gave it worked examples -- "woh payment humare system mein complete
nahi dikh raha" -- which is almost verbatim the sentence
CLAIMED_CHARGE_NEVER_CAPTURED already appends. I taught it to write the line the
service was going to write anyway.

**verdict:** corrected. The model is now told to leave the payment's state alone
entirely and write the symptom and the next step; the appended sentence owns the
facts. Same separation as the refund amount, applied to the payment's status.

**the general point:** a prompt is not edited in isolation. It sits next to
templates, and guidance written against one failure can collide with a component
that was already handling the same thing. The check is to read the ASSEMBLED
output, not the model's half.

**second finding from the same re-record:** T-1004 came back at exactly 0.60
against the 0.6 floor I had just raised from 0.55 to catch its previous 0.55.
Threshold tuned to an observation, observation moved. Replaced with a word-count
rule on the input. Written up in the README.
