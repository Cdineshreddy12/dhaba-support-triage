# Project skills

Conventions for this repo, split by the layer they govern. Each is a `SKILL.md`
with frontmatter describing when to load it.

| Skill | Governs | Load when |
|---|---|---|
| [dhaba-triage](dhaba-triage/SKILL.md) | **index + architecture** | any work in this repo — start here |
| [money-gate](money-gate/SKILL.md) | `src/domain/ledger.ts`, `refund-policy.ts` | refunds, amounts, reading `purchases[]` |
| [llm-boundary](llm-boundary/SKILL.md) | `src/llm/`, `src/service/` | prompts, providers, retry/degrade, injection |
| [api-contracts](api-contracts/SKILL.md) | `src/domain/*.ts`, `src/server.ts` | schemas, routes, status codes |
| [observability](observability/SKILL.md) | `src/log.ts`, every log call | logging, redaction, metrics |
| [testing-practice](testing-practice/SKILL.md) | `test/` | writing or reviewing tests |
| [git-workflow](git-workflow/SKILL.md) | commits, PRs | every commit and push |

The invariants that cut across all of them are in
[dhaba-triage](dhaba-triage/SKILL.md). Read those before changing anything.
