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
