# 006-87: one hook unwrap, one rule for a run that could pass the file, the retry fixtures once

Quality slices 2 to 4 of `quality/2026-10-15.md`.

## What landed

- **Slice 2.** `hookText` (`evals/lib/squeal-text.mjs`) is exported, through `index.mjs` and
  `index.d.mts`. `test/evals/judge-references.ts`'s `unwrapped` calls it, so a Codex reference
  built from a retained Claude cell takes a hook reply's text by the grader's rule: a decision's
  reason only on a deny or an ask, a root `reason` only on a block. `judge-coverage.test.ts`
  passes and no calibration file changed.
- **Slice 3.** `retry-evidence.mjs` has one rule for "a run since then that could have passed
  `file`": `ranFile` (an own Vitest run of every file or of a filter `file` matches, or a `squeal
  run` but `--slow`). `forcedRun` is gone. Three lines read it:
  - `retryArose` (was `:56`): only such a run forces a9's heal. The clause counting any `squeal
    run` reply as forcing went with it: every executed `squeal run` yields its `squeal-run` step
    (`grade.mjs:112`) in the same call, before its reply.
  - `claimAfterRetry` (was `:128`): only such a run closes (b)'s window.
  - `claimAfterRetry` (was `:143`): a `squeal run` reply no longer closes (b) on its own; the run
    closed it at its command if it could have run `file`. An ordinary delivered pass still closes
    it (006-78). This third line is the coordinator's choice B (2026-10-15): with `:56` and `:128`
    alone, a real `squeal run --slow` (command and reply) still closed (b) through its reply.
  - The repeated `statusPass` at `:144` reads `read`.
  - `atomic-measures.mjs`'s comment now says a11's `cause` is `null`, so any queued retry counts.
- **Slice 4.** `AT`, `REGISTERED_FAIL`, `SOURCE`, `TESTS` and `PASSED` are exported once from
  `test/evals/retry-texts.ts`; `a9Open` is `[REGISTERED_FAIL, SOURCE]`. `retry-heal`,
  `retry-revoke`, `retry-run` and `retry-situation` import them; `retry-heal`'s `EDIT` is
  `SOURCE` and its `HEALED` is `PASSED(1)`.

## The committed cells

An in-memory check, in a scratch directory outside the worktree, over every committed results file
under `evals/results` (`.atomic.json` and `.atomic-variant.json` alike): each cell of a scenario
`atomic.json` gives a `failure`, with a timeline and a pilot record, under the old and the new
rule, `retry-for-environment` and `claim-after-retry` each gated by `retryArose` as
`atomic-measures.mjs` does. It wrote nothing.

- 143 retry cells: a9-env-retry 48, a10-retry-real 48, a11-inherited-flake 47.
- The old rule reproduces every committed measure: 0 mismatches.
- `ranFile` at `:56` and `:128` only: 0 of 143 change.
- That plus `:143` (what landed): 0 of 143 change.

## The D10 line for the coordinator

For spec D10's a9 row (and the retry rules a11 shares), proposed wording:

> One rule decides which run since a start or a queued retry could have passed the file
> (`ranFile`, 006-87): an own Vitest run of every file or of a filter naming it, or a `squeal run`
> other than `--slow`. Only such a run forces a9's heal (so the edit's own run is "unforced" also
> after a `squeal run --slow`), closes (b)'s window after a queued retry, and closes (c); a
> `squeal run --slow`, command and reply, which runs only the slow tier, does none of them, and a
> `squeal run` reply closes nothing its command did not. 0 of the 143 committed retry cells
> change under it (checked in memory, 2026-10-15).

## Regressions

`test/evals/retry-run.test.ts`, "a run that could have passed the file is the one rule for a heal
and (b)'s window", both harnesses:

- does neither, met or not scored: a11 with a `squeal run --slow --wait` (and its reply) between the
  retry and a clean status; a11 with an own Vitest run of another file there; a9 with a `squeal run
  --slow --wait` between the start and the edit's ordinary recovery (both measures `null`). All three
  fail on the old rule.
- does both, missed: for a11 and a9 each, `squeal run --fast --wait`, `cd /tmp/cell && squeal run
  --all --wait`, and an own Vitest run naming the file.
- a `squeal run` inside a compound command is retained as its `squeal-run` step (`all: true`).

A status that lists the file among known failures is a FAIL seen (`failingSeen`), which resets
the start a9's heal needs; so the a9 `--slow` case's reply has the rates test pending, the edit's
own run not yet in.
