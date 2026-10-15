# 010 wave 1: the workflow

## 010-10 triggers, docs skip, cancellation, one full Node in three shards

Use /worker. Shape: slice.

Outcome: `.github/workflows/ci.yml` implements spec 010 D1 to D5, with the version-sensitive list and its guard test, and the coordinator skill carries D6.

Read: `docs/specifications/010-ci-cost/spec.md` (D1 to D6, Testing), `research/ci-test-time.md` 3 and 4 (the list's origin, shard numbers), `research/ci-run-triggers.md` 3 and 4 (filter and concurrency semantics, the `version` job).

Starting seam: `.github/workflows/ci.yml`. First edit: the `on:` block (D1, D2), then `concurrency` (D3). Leads, yours to settle:
- The Node 24 job runs lint and typecheck once (D5) beside its subset; each Node version keeps build and the drift step.
- Vitest's positional filters match path substrings, not globs: the list file holds paths or prefixes the job passes as they are.
- The `version` job must not run on `workflow_dispatch`, where `github.event.before` is empty.
- Job names say what they ran (`Node 22 (1/3)`, `Node 24 (version-sensitive)`): the process reads a failure by test name in the failing job's log.

Owns: `.github/workflows/ci.yml`, the list file (a name of your choosing under `test/`), one guard test under `test/`, and D6's lines in `.claude/skills/coordinator/SKILL.md` and `.agents/skills/coordinator/SKILL.md` (kept identical). Leave everything else alone: no `src/`, no bundles, no version raise (no bundle changes), no `docs/` edits.

Done when: the guard test passes and fails when you add `process.versions` to a test file outside the list (say so in your final message, then revert it); `npm run lint` and `npm run typecheck` pass; `squeal run --all --wait` output pasted; the workflow checked against the GitHub docs the research cites, no new tool installed, with any key you are unsure of named. Do not push: the coordinator pushes the candidate, whose own CI is the test (spec Testing).

Final message: decisions the spec did not settle, the list's contents with a line on why each entry is version-sensitive, and the exact `cancel-in-progress` and group expressions.

## 010-11 review of 010-10 and 010-12

Use /reviewer. Shape: review.

Outcome: `docs/specifications/010-ci-cost/reviews/wave-1.md`, a verdict on candidate `cand/010-10` at bf0a41fb (rows 010-10 and 010-12; no bundle change, no version raise).

Read: `spec.md` D1 to D7 and Testing, `status.md` (the amendments of 2026-10-15), `research/ci-run-triggers.md` 3 and 4, `research/ci-pr-flow.md` 3.

Range: `git diff origin/main...bf0a41fb -- .github .claude test`. The code is `.github/workflows/ci.yml`, `test/version-sensitive.txt`, `test/version-sensitive.test.ts` and section 6 of `.claude/skills/coordinator/SKILL.md` (`.agents/skills/coordinator` is a symlink).

Check:
- Each D against the workflow. Can a filter, the concurrency group or a job condition drop a run the process reads: a `cand/*` push, a main code landing, the `version` check of a main push's range, or the nightly?
- The list: does it hold every test whose result can differ between Node 22 and 24? Should `test/e2e/plugin-copy` (no version read found) stay? Is the guard test's model of Vitest's filter right?
- D7 cannot run from a branch: read the `schedule` trigger and the job conditions against GitHub's docs.
- Evidence already recorded: the candidate's CI run 38776179771 (three Node 22 shards, the Node 24 job, `version` and `nightly` skipped); a new branch at the same SHA started no run (`status.md`). Read the run's result with `gh run view`; GitHub is read-only for you.

Verification: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` in your tree, plus lint and typecheck.

Done when: the findings file is committed alone, every finding labelled proven, plausible or unverified, and your final message gives the verdict.
