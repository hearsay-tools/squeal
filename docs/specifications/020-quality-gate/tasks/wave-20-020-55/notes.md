# Row 020-55 notes: the gate keeps the result of a file it reran under load

Worker 9a30a36d, wave 20, 2026-11-14. Shape: slice. Base: main at `4fe1a2d29`
(0.1.477).

A file that failed here under load and ran once more (row 020-54, D3.4) now
has its rerun's result kept at its key. The next gate on the same bytes
reads it from the stores and does not run it. Before, neither run was kept,
so that file ran again on every gate. The first run's failure is never
kept. An input changed or written between the lookup and the rerun's end
bars the keep.

## Commits

| Commit | What |
| --- | --- |
| `78c2a129e` | The change and its tests: `collect.ts` (`GateRun.retrying`), `keep-expected.ts` (`Expectations.take`, `Taken`), `keep.ts` (`#queue`), `lanes.ts` (`runOne` tells the rerun), `retry.ts` (`withoutRetried` removed); tests `keep-rerun` (new), `lanes-retry`, `collect-retry`, `code-gate-retry`. |
| (this file) | Notes. |

## How it works

1. `lanes.ts` `runOne` tells every run to the keeper, the rerun too (the
   `rerun === undefined` guard is gone). A first run with files to rerun
   names them in a new field, `GateRun.retrying`. Its `records` are whole.
2. `Expectations.take(run)` takes each lookup that expected a file of the
   run, as before. When the run names `retrying` files of that lookup, it
   splits the lookup in two:
   - the files not retried: the caller decides them now, from this run;
   - the retried files: they stay expected, as a lookup of their own with
     the same snapshot of inputs, listed files, runtime identity, revisions
     start and `WorktreeKeys` run number as the lookup began them.
   It returns `Taken { pending, endsRun }`. `endsRun` is false for a split
   lookup, so `Keeper.#queue` does not end its run of keys.
3. The rerun's tell takes the held lookup. The keeper decides the retried
   files from the rerun's report and records, with `keepDecisions` over the
   lookup's snapshot, and ends the run of keys then.
4. When no rerun is told (the budget ended before it started),
   `Expectations.close` ends the held lookup's run of keys. Nothing of the
   file is written.

So the stability window of a retried file runs from the lookup to the
rerun's end: an input changed during the first run, between the runs or
during the rerun bars the keep. Everything else the keeper judges (reads
first seen after the lookup, merge hold, listings, environment files,
runtime identity) is judged over that window too, because it is the same
lookup.

The store holds one result per test and key (`results` primary key
`(check_id, key)`), so a later write at the key replaces an earlier one.
The mutation check below showed it: with the first failure kept too, the
rerun's pass still replaced it at the key. The only case where a kept first
failure would stay is a rerun that does not complete; the keeper's split is
what prevents it.

## Proposed spec text

**D17.3, replace the row 020-54 amendment** ("Amended 2026-11-13 (row
020-54; the coordinator, request 27108c13, "A"): neither run of a file that
ran again under load (D3.4) is written. ... A follow-up row may keep the
rerun's result at the key.") with:

> Amended 2026-11-13 (row 020-54) and 2026-11-14 (row 020-55; the human,
> 2026-11-14: "Row 020-55: Build it"): the result of a file that ran again
> under load (D3.4) is its rerun's, and the gate keeps that one at the
> file's key, as the daemon's rerun replaces its row (001-171). Its first
> run is never written. The keeper hears the first run without deciding
> that file, and holds the file's lookup, with the inputs and the run of
> keys the lookup began, until it hears the rerun. So every bar above is
> judged from the lookup to the rerun's end: an input changed or written
> during the first run, between the runs or during the rerun bars the
> keep. A rerun that did not complete the file, or that never started,
> writes nothing; the next gate on the same bytes runs the file again. A
> kept rerun, passed or failed, is read by the next gate on the same bytes
> from the stores (D11.7), and is not run again (D3.4: no rerun for
> evidence from the stores). A retried file not kept is named in the
> not-kept lines as any other file is.

**D3.4, add at the end** (after the row 020-54 text):

> Amended 2026-11-14 (row 020-55): when the rerun completes the file, its
> result is kept at the file's key under D17.3's rules; the first run's
> never is. A later gate on the same bytes reads it from the stores and
> does not run the file again.

D3.5, D7 and D11.2 do not change. No report field, no stderr line and no
exit code changes. `QUALITY_POLICY_VERSION` does not change.

## Decisions the spec did not settle

1. **Keep open, not add again.** The brief gave two ways: keep the
   retried files' expectations open past the first tell, or add them again
   from the same lookup before the rerun (a new `keys.beginRun()` and a
   fresh inputs snapshot). I kept them open. A fresh snapshot at the
   rerun's start would not see an input edited during the first run and
   left edited, so the rerun's result would be kept at a key its bytes no
   longer match. Keeping the lookup's snapshot and run number covers the
   lookup to the rerun's end with no new state. The keeper test "does not
   keep it when an input was edited during the first run, before the
   rerun" checks that window start.
2. **An explicit field, `GateRun.retrying`.** The keeper must know at the
   first tell which files a rerun will decide. A file with no record is not
   that signal: a file can complete with no record for other reasons. So
   the first run names them. It is an in-process type, not a `RunReport`
   field, so `MERGE_RULES` (`src/core/daemon/report-merge.ts`) does not
   apply.
3. **`withoutRetried` is removed** (020-54's notes said it stays). Once
   the keeper splits the lookup, it never decides a retried file from its
   first run, record or not. `withoutRetried` was then a second guard for
   the same rule, with no test of its own. The rule now lives where the
   keeping is decided, and the keeper test "never keeps the first failure,
   record and all" proves it with the first run's record present. Within
   my ownership; no other caller.
4. **A rerun that failed again is kept, failed.** The rerun's result is
   the file's result (D3.4), and the brief asks to keep "the rerun's
   result" with no exception. The next gate on the same bytes reads the
   failure from the stores and does not rerun it. That matches a failure
   under the threshold, which the keeper kept before this row too. I did
   not read the daemon's rerun code (001-171) to compare; the board row
   says its rerun replaces its row.
5. **The run of keys stays in flight until the rerun's tell or `close`.**
   `WorktreeKeys.#runsInFlight` matters only to `beginRun`, which clears
   the first-hashed map when no run is in flight. In the gate every lookup
   begins its run before any run starts (D14.4), so holding one open longer
   changes nothing else. Each `beginRun` still gets exactly one `endRun`
   (keeper test: `[0, 1, 1]` and `[0, 0, 1]` ends at the first tell, the
   rerun's tell and `close`).
6. **No new line for a retried file not kept.** The not-kept lines name
   it with its reason, as they name any other file (CLI test: "... because
   ... (src/math.ts): test/flaky.test.ts; the next run will run it again").

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| The second gate on the same bytes reads a retried file `from: store` with the rerun's outcome | `test/cli/code-gate-retry.test.ts` "keeps the rerun's result: the next gate on the same bytes reads it" (first gate: retried, passed, no not-kept line; second gate at load 3: both files `store`, `failed: []`, verdict `pass`, exit 0, no `retried`). `test/code/gate/keep-rerun.test.ts` "at the lookup's key, with the rerun's outcome" (`pass` at the lookup's key) and "keeps a rerun that failed again, failed" (`fail`). |
| An input edited during the rerun is not kept | `code-gate-retry` "does not keep the rerun's result when an input was written during it": the flaky test's second run writes `src/math.ts` again with its own bytes; stderr names `test/flaky.test.ts` as not kept for `src/math.ts`; the next gate runs it (`from: run`). `keep-rerun` "does not keep it when an input was edited during the rerun" (the not-kept line, nothing at the key, the other file kept). |
| The window starts at the lookup (the brief's "either run") | `keep-rerun` "does not keep it when an input was edited during the first run, before the rerun". |
| The first failure is never kept | `keep-rerun` "never keeps the first failure, record and all: with no rerun, `close` ends the run": the first run's tell carries the retried file's record and names it in `retrying`; no rerun; nothing at its key. Mutation-checked (below). `lanes-retry` "does not rerun when another run spent the budget first": the first tell names the file in `retrying`. |
| The keeper hears the rerun | `lanes-retry` "reads passed and retried when the rerun passes": three tells, the rerun last, the first naming `n/flaky.test.ts`. `collect-retry` (real node:test): two tells, the first naming `broken` and `flaky`, the rerun's with their records. |
| D17.3's text in notes | "Proposed spec text" above. |

## Checks run

Host load during the work: one-minute load 70 to 104 on 24 CPUs.

- `pnpm run lint`: `Checked 3385 files in 7s. No fixes applied.`
- `pnpm run typecheck` (`tsrs --fast --noEmit`): exit 0. Also
  `pnpm exec tsc --noEmit -p .` after each source edit: no diagnostics.
- `squeal status --wait` on `keep-rerun`, `lanes-retry`, `code-gate-retry`
  and `keep.test.ts` (revision 15): "no known failures; 4 test files, each
  with a current result, after 28.5 s". `squeal status --check` on the two
  new `code-gate-retry` cases: both `pass`, from the run at revision 15.
- `squeal status --wait` on `collect-retry` and `keep-rerun` (revision 19,
  the commit): "no known failures; 2 test files, each with a current
  result, after 14.7 s".
- First run of `keep-rerun` failed on the test, not the code: it counted
  the file-level result row too (`['pass', 'pass']`), and one case timed
  out at 5 s at load 104. Fixed by reading the test's own row and a 60 s
  timeout per case; then FAIL -> PASS for all five.
- `lanes-retry` "reads passed and retried..." failed at revision 5 on its
  old expectation (no rerun tell), as intended; FAIL -> PASS after the
  update.
- Mutation check, direct `node_modules/.bin/vitest run
  test/code/gate/keep-rerun.test.ts`, with `take` giving the first decision
  the whole lookup (retried files included): 2 failed, 3 passed. "never
  keeps the first failure" failed with `expected [ 'fail' ] to deeply equal
  []`. Source restored from a copy; `git status` showed only the intended
  changes.
- Affected checks, `squeal status --wait 1200000` over the five changed
  source paths (revision 21, the notes commit): 359 test files selected.
  After 1202.7 s: 135 pass, 1 fails, 224 still queued for CPU ("the host
  is busy (23 of 24 cores in use)"); exit 3. Load at the end: 92.07,
  109.84, 92.20 on 24 CPUs. The one failure is
  `test/cli/status-wait-pool.test.ts` "with no row, a predecessor's, ...
  the text is today's": the status text said "the deadline passed after
  0.3 s" where the test's first reading said "0.1 s". It is a timing text
  in the status-wait code, which this row does not touch; row 020-54's
  notes saw the same file fail under load. I asked `squeal retry
  test/cli/status-wait-pool.test.ts --reason load` and did not rerun it
  myself.
- A second wait, named on the 35 keeper, collector and lanes test files
  (`test/code/gate/keep*`, `collect-*`, `lanes*`, `test/cli/code-gate-keep*`,
  `code-gate-failed-outside`, `code-gate-log`) and `status-wait-pool`
  (revision 22): "no known failures; 36 test files, each with a current
  result, after 210.7 s"; exit 0; load 43.28, 72.35, 80.87 at the end.
  `status-wait-pool` went FAIL -> PASS on its load retry, under the same
  tracked inputs.
- End state of the affected checks: the 36 named files pass at revision
  22. Of all 359 files that read the changed sources, 135 had passed at
  revision 21 (some of them among the 36); the others not named were
  still queued for CPU when I stopped waiting, and their results are not
  known to me. I did not wait for them (wave rule: targeted tests only; CI
  runs them all).

## Checks not run

- `pnpm run build`: the wave forbids it in a worker tree. This row does not
  own the bundles. The bundle drift checks (`cli/squeal.mjs differs from
  the build`) are expected to fail until the coordinator rebuilds.
- No full suite (wave rule; CI runs it).
- No run on a really overloaded host for the rerun itself: the tests set
  the load reading only (`hostLoad`), as row 020-54's do.
