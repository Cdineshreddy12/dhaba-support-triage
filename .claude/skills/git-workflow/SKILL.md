---
name: git-workflow
description: Commit, branch, and GitHub conventions for the Dhaba triage repo. Load before every commit, before pushing, and before opening a PR. Carries two hard rules - no AI co-author trailer, and the commit author email must be the GitHub noreply address - plus the reasons the history itself is being graded.
---

# Git workflow

**The commit history is part of the submission.** The brief says *"commit as you
go; we read the history."* A repo whose history is one large commit reads as
work done in a single session at the deadline, whatever its quality.

## Two hard rules

**1. No AI attribution in commits. Ever.**

No `Co-Authored-By: Claude`, no `Generated with`, no agent name in a trailer or
message body. This is a standing instruction from the repo owner and it is not
negotiable. AI usage is disclosed where the brief asks for it — `docs/ai-log.md`
and the README's task 4 section — not stamped into commit metadata.

Verify after committing:

```bash
git log -1 --format='%b'   # must be empty of trailers
```

**2. Author email is the GitHub noreply address.**

```
142651342+Cdineshreddy12@users.noreply.github.com
```

Set repo-locally. GitHub attributes commits by **email**, ignoring the name
field entirely — a personal address verified on a different account will link
the commit to that other account, and a public repo exposes the address. This
already happened once on the first commit and had to be amended.

Check attribution actually landed:

```bash
gh api repos/Cdineshreddy12/dhaba-support-triage/commits \
  -q '.[] | "\(.sha[0:7]) \(.author.login // "UNLINKED")"'
```

`UNLINKED` or a wrong login means the email is wrong.

## Commit messages

Subject in imperative mood, `type: summary` under ~72 chars. Body explains
**why**, and especially what was rejected — the history is where reasoning is
visible to a reviewer who was not there.

Types in use: `feat` `fix` `test` `chore` `docs` `refactor`.

Good:

```
feat: refund gate reads ledger facts and one constrained claim type

The model cannot name an amount: evaluateRefund has no parameter for one.
Amounts are read out of captured payments and assertSpendable throws if a
rule ever returns money with no capture behind it.
```

Bad: `update files`, `fix bug`, `wip`, or a list of changed filenames — all of
which `git diff` already says better.

Record a caught agent mistake in the message when one is being fixed. Those
commits are evidence of supervision and they are what task 4 is written from.

## Granularity

One commit per coherent change: a layer, a rule, a fix. Tests land with the code
they cover, not in a trailing "add tests" commit — a reviewer reading the diff
should see the behaviour and its proof together.

Never squash the history into a tidy story at the end. The real shape of the
work is the thing being read.

## Branches and PRs

Trunk-based on `main` for small changes. For a substantial piece, branch and
open a PR with a self-review on the diff explaining the two or three non-obvious
choices — they look at GitHub, not just `git log`, and a self-reviewed PR is a
work sample of how you behave on a team.

## Before pushing

```bash
npm run typecheck && npm test && git log -1 --format='%an <%ae>%n%b'
```

Never push a red main. CI runs without an API key, so a green local run with a
key set is not proof — check the Actions tab after pushing.

## Related

`dhaba-triage` (index) · `testing-practice` (what must pass first)
