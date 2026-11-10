# Issue 168: clean fast-forward, lint Stop and code notices

Keep Git-brought FAIL notices and treat inherited-change Stop policy and authorship wording as separate decisions.

## Scope and verdict

[Issue #168](https://github.com/hearsay-tools/squeal/issues/168) was read with
`gh issue view 168 --repo hearsay-tools/squeal --json number,title,body,comments,url`.
Research ran on 2026-11-10, within the 20-minute bound. No product, board, spec,
status or skill changed. Existing holds stand.

| Question | Answer and evidence tag |
| --- | --- |
| 1. Can a clean fast-forward before any session edit cause a lint Stop hold? | **Yes, reproduced on 0.1.422**, with one inherited pending path and clean Git status. `verified by experiment` |
| 2. Can it deliver FAIL CRAP as “code changes”? | **Yes, reproduced on 0.1.422.** CRAP 2 → 72 yielded “1 code change”; the next unchanged delivery was silent. This is an actual state transition. `verified by experiment` |
| 3. Does that prove the code subsystem marked the function as an agent edit? | **No.** The code store marked the path as pulled and kept its edit marks null. Separately, a status line incorrectly said “Squeal saw your edit.” `verified by experiment`, 0.1.422 |
| 4. Can base-commit results safely replace validation here? | **Not determined**, because this probe has no validated B result from a second worktree or matching-key comparison. Commit ancestry alone is insufficient under 011 C3 and 017 D5. `read in source code` / `inferred`, checkout a97402f5 |

## Experiment

Runtime: installed Squeal **0.1.422**, Node **24.22.1**, ESLint **10.13.0**.
Claude Code hook bundles came from tag `squeal--v0.1.422`, commit
`fd1a98f70478bfdd7f18c64c97830e72d915d06d`; the CLI came from
`/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.422/dist/cli/squeal.mjs`.
The checkout is `a97402f5e1f1d90a91feb41c30ad86db93555644` (0.1.423).
The source functions cited below are unchanged from the examined tag.

Initial host load was **4.60/24 CPUs**. Each live attempt checked again before
creating the fixture. The final ordinary-lint run measured **2.91/24** at
01:43:47Z; the pending-lint run measured **4.00/24** at 01:43:07Z.
These are 02:43:47 and 02:43:07 Europe/Warsaw.

Commands, fixture and full transcripts are in
[`research/probes/issue-168/`](probes/issue-168/README.md):

```sh
python3 docs/specifications/011-core/research/probes/issue-168/probe.py
ISSUE168_SLOW_LINT=1 python3 docs/specifications/011-core/research/probes/issue-168/probe.py
python3 docs/specifications/011-core/research/probes/issue-168/inspect-store.py <printed PRIVATE_ROOT>
```

The fixture owns a private Git repository, store and XDG directories. It runs one
node:test and one lint file. It uses `checks: [{name: "lint", lint: true, at:
"stop"}]`; `lint.blocking` stays false. Before registration, commit A contains an
uncalled function of complexity 1; upstream B raises it to 8. Tests pass at both
commits. A's lint result is primed before registering at revision 0. The initial
Stop is silent. In a new turn the only workspace mutation is
`git merge --ff-only origin/main`. Git status is empty before and after it, and
at the end. The new revision is 1. All fixture daemons were stopped successfully.

**Q1, verified by experiment, 0.1.422.** With ordinary ESLint, `squeal lint
src/a.js --json` read `outcome: "pending"`, `pending: 1`. Stop returned:

```text
Squeal policy checks puts the lint group at stop and 1 lint check is not linted at revision 1: src/a.js. `squeal run lint --wait` runs them and waits for their results.
This is Stop's last hold this turn: no later Stop in it waits for the lint group ...
```

The fixture's test file was already current and passing. A second run used a
five-second sleeping local lint rule to keep this window open without CPU-heavy
work; it returned the same hold. An earlier paused-turn control had already
finished lint and did not hold. Thus a clean fast-forward can cause the hold;
it does not inevitably do so after lint settles.

**Q2–Q3, verified by experiment, 0.1.422.** PostToolBatch returned:

```text
SQUEAL · 1 code change at revision 1
FAIL CRAP: cold (src/a.js:1): 72, over 30 (complexity 8; no test runs it in the test's own thread; 1 test file loads this file).
```

`code --changed --json` selected the `crap` fail at revision 1, since the oldest
registration at 0. Complexity stayed below its threshold. The untested state
already failed at registration and was not reported again. The next unchanged
PostToolBatch produced no output. The code store contained
`pulled:<worktree> = [["src/a.js",1]]`; `edited_revision` and `edited_at` were null
for complexity, CRAP and uncovered. This is evidence of correct Git attribution
in the code pass, not an own-edit mark. However, the ordinary-lint Stop also
said **“Squeal saw your edit; the 1 test file it re-keyed is current”**. That
sentence attributes the observed workspace change to the session despite this
probe making no authored edit.

## Source findings and deciding tradeoff

**Read in source code, 0.1.422.** `no-edit.ts::unchangedSinceRegistration`
exempts the main agent only while its registration revision is latest and the
scan is trusted. Its comment explicitly says another session's revision counts.
`stop-required.ts::requiredStep` uses that exemption; then
`required.ts::requiredLintOpen` selects all pending/stale lint checks in required
groups. Neither selection tests whether Git brought the path. 011 C2 records
changed bytes as revisions with HEAD/dirty provenance. A clean tree is not an
unchanged revision.

**Read in source code, 0.1.422, and repository spec at a97402f5.** 015 D6 says
“a FAIL from git is told.” Status amendment 2026-10-27 and board row **015-83**
record the human's choice to keep pull coverage notices. `code-delta.ts::toldKind`
retains a new fail from Git. `code-format.ts::codeChanges` counts result changes;
`code-since.ts` bounds them by registration, not authorship. D6 defines
`--changed` as functions whose state changed. D7 keeps code failures out of test
known-failure counts and leaves code blocking off by default. The observed CRAP
notice satisfies these rules; its heading alone does not prove false edit marks.

**Read in source code/spec, a97402f5; inference for the proposal.** 011 C3 keys
results by inputs, never commit identity. 017 D5 includes file bytes, computed
configuration and its closure, tool/provider versions, installed packages and
keyed environment. D7 already looks up each key and uses hits without linting.
The report's proposed “base commit's record” is safe only when the applicable
keys and evidence match. This experiment supplies no proof of a missed matching
cache hit, nor permission to call an unvalidated path passing.

Recommendation: preserve valid first-failure delivery and state-based
`--changed`. Ask the human to decide the inherited-only Stop exemption and the
wording that claims authorship. The deciding tradeoff is completion policy over
current workspace evidence versus assigning work from a base update to an agent.
This report proposes no implementation and changes no existing approval.

## Limits and sources

The original 204-file Cezar worktree, oxlint, 3,225-check backlog, revision 6 and
28 notices were not reproduced. The report did not record an incident runtime
or JSON snapshot; it names 0.1.422 as current afterward. These probes use direct
Claude hook calls, not a live Claude model or a human-question UI. No external
full suite ran. Two initial setup failures are documented in the probe README.
The original scheduling delay and any missed cache reuse remain open.

Verification: both final probe processes exited 0; their transcripts confirm the
holds, notices, clean status and daemon stops. Python syntax checks and
`git diff --check` passed. The repository command `squeal status --wait 60000`
with the report and two probe paths exited 3: no test closure covers these
research files; known failures 0, all 1,562 test files current. This is not a
claim that a suite ran for this documentation change.

- [Issue 168](https://github.com/hearsay-tools/squeal/issues/168), fetched with `gh`.
- [0.1.422 source](https://github.com/hearsay-tools/squeal/tree/fd1a98f70478bfdd7f18c64c97830e72d915d06d), read locally with `git show`; source checks against the checkout used `git diff squeal--v0.1.422 -- <cited paths>` (empty).
- Source paths: `src/harness/shared/{no-edit,stop-required,stop-lint}.ts`; `src/core/state/required.ts`; `src/core/delivery/{code-delta,code-format,code-since,edits}.ts`; `src/core/code/pass/head.ts`.
- Repository rules: [011 C2/C3/C8](../spec.md), [017 D5/D7/D8](../../017-lint-checks/spec.md), [015 D6/D7](../../015-coverage-complexity/spec.md), and their `status.md` amendment logs.
- Experiment evidence: probe README, `fast-lint.log`, `pending-lint.log`, `settled-control.log`, and `store-evidence.log` in the linked probe directory.
