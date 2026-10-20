# Issue 54: a passing same-key load retry replaces the failure

Researcher findings for hearsay-tools/squeal#54, 2026-10-20. Squeal 0.1.230 source (`package.json`),
worktree branch `cez/b6f9e4e2` at `d86fcb409`. Reproduction only: no design or implementation is
proposed here, and the existing holds stand.

**Verdict.** Reproduced, synthetically, on the current source. A passing `--reason load` retry at the
failure's key replaces the failing row at `(check_id, key)`. `squeal failures` then lists nothing, and
`squeal why` keeps one summary line and no run, log, time, revision or load. That is what spec 011
specifies today (C6: `failures` "lists failures still stored, not every failure ever seen"; C7: "the
newest run from any worktree replaces the stored outcome"), so the issue asks for a change of spec.
It is not a regression. Part of the evidence outlives the replacement for a while: the failing run's
`runs` row, its log directory and its `failed-run-loads` entry are still on disk, but no read path
links the check to that run. The run row and its log go at the 7-day prune cutoff, or at once when
the worktree is removed.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a passing same-key load retry remove the failure from `squeal failures`? | Yes: `Failures in this worktree (1 failure …)` before, `No stored failures in this worktree.` after | verified by experiment |
| 2 | What does `squeal why` keep? | A `Flaky: FAIL -> PASS` line with the key and flip time, the replaced failure's summary, and the history transitions (revision, time). No run id, log path, recorded time or load for the failing run. `Results` and `Run log` show only the passing run | verified by experiment |
| 3 | Is the evidence deleted or only unlinked? | Unlinked: after the retry the failing run's `runs` row exists, its log dir exists on disk and `failed-run-loads` still holds 3.33 for it, but no result, flaky note, retry record or transition names its run id | verified by experiment |
| 4 | How long does the unlinked evidence last? | A run no result references is deleted with its log dir once it is older than the retention cutoff (7 days by C7), or at once when its worktree is removed; `failed-run-loads` keeps the newest 1,024 runs | read in source code |
| 5 | Two flips of one check, as in the incident (revisions 1 and 2)? | `why` keeps one flaky note per check: a later flip replaces the earlier one, so the first failure loses even its summary line | read in source code; not run |
| 6 | Is it as specified? | Yes, C6 and C7 as amended describe exactly this | read in spec |
| 7 | Incident reproduction (cezarion PR #1330)? | Not reproduced, because the incident store is in another project's checkout and replaying it was out of scope; the incident output quoted in the issue matches the synthetic one line for line in shape | inferred |

## Findings

**Q1, Q2 (verified by experiment).** `probes/issue-54/probe.test.ts` drives the product scheduler
through the 001-368 retry fixture (`test/scheduler/retry-fixture.ts`): `test/flaky.test.ts > flips`
fails while a marker outside the worktree exists, which no key covers. Load is injected through
`SchedulerOptions.hostLoad`, 26.64 on 8 CPUs (3.33 per CPU) at the failure and 4 at the retry,
with `rerunCap: 0` so no 001-171 re-run intervenes. The probe asks a `load` retry, removes the
marker, lowers the load and runs one reconciliation pass. The retry ends `passed` at the same key
`13b164a38a5d`. Before and after, from `probes/issue-54/output.txt`:

```text
---- squeal failures (before)
Failures in this worktree (1 failure, newest first):
  FAIL  2026-10-20T16:44:00.689Z  test/flaky.test.ts > flips
        <worktree>/…/main (this worktree), revision 0, commit 95603d9, clean, 6 ms, run 4086a9d4-…
---- squeal failures (after)
No stored failures in this worktree.
---- squeal why (after)
Known state: PASS, current, observed at revision 0, commit 95603d9
  Flaky: FAIL -> PASS under the same inputs (key 13b164a38a5d, 2026-10-20T16:44:01.192Z)
    the FAIL it replaced: expected true to be false // Object.is equality; diff (- Expected, + Received): - false | + true
History (2 transitions, oldest first):
  revision 0  2026-10-20T16:44:00.694Z  first seen FAIL
  revision 0  2026-10-20T16:44:01.193Z  FAIL -> PASS
Results (1, newest first):
  PASS  2026-10-20T16:44:01.191Z  … run 5f05a61a-…, 2 ms, key 13b164a38a5d
Run log: …/runs/5f05a61a-…/vitest.log
```

This has the same shape as the incident output in the issue: the flaky line, the replaced summary,
the history, and no failing result.

**Q3 (verified by experiment, read in source code).** After the retry the probe reads:
`failing run still in runs table: true; log dir on disk: true; load kept in failed-run-loads: 3.33`.
Nothing that `failures` or `why` reads names run `4086a9d4-…`:

- `results` has `PRIMARY KEY (check_id, key)` (`src/core/store/schema.ts:99-116`) and `putMany`
  writes `INSERT OR REPLACE` (`src/core/store/repos/results.ts`), so the pass overwrites the fail.
  `listFailures` selects `r.outcome = 'fail'` from that table, so it finds nothing.
- The flaky note (`meta` `flaky-checks`, `src/core/state/flaky.ts` `recordFlips`) keeps `key`,
  `from`, `to`, both worktree ids, `at` and the replaced `summary`, but not the replaced row's run
  id, revision, recorded time or duration, although `recordFlips` holds the whole replaced
  `ResultRecord`.
- The retry record (`meta` `retries`) ends with the passing run's id only:
  `"end":{"outcome":"passed",…,"runId":"5f05a61a-…"}`.
- `transitions` has no run id column (`schema.ts`, `CREATE TABLE transitions`).
- `failed-run-loads` is keyed by run id (`src/core/retry/load.ts`), so the load survives but cannot
  be reached from the check.

The one existing precedent for keeping a replaced failure's run is `rerun-first-failures`
(`src/core/state/rerun-first.ts`, gh-20, 011-19). It keeps the first error with its run id, and
`why` resolves that run's log dir (`src/core/status/why.ts:180-184`). It covers only a slow file's
file-level failure re-run, and only while the key stands.

**Q4 (read in source code).** `src/core/store/prune.ts:89-99` deletes a `runs` row that no result
references when its worktree is gone, or when it has ended and is older than the cutoff
(`now - retentionDays`), and removes its log dir (`removeRunLog`). Once the pass replaced the
failing row, nothing references the failing run, so its log lives at most until the next prune
after the retention window. `failed-run-loads` and `flaky-checks` each keep their newest 1,024
entries.

**Q5 (read in source code; not run).** `recordFlips` stores one note per `checkIdentity` and replaces
an existing one (`kept.delete(id); kept.set(id, note)`). In the incident the check flipped twice,
at revision 1 and revision 2; whether the keys differed was not verified. Only the later flip's note can remain, which
matches the single `Flaky` line the issue quotes (key `a6489248b526`).

**Q6 (read in spec).** `spec.md` C6 (amendment 2026-10-15, tasks 001-403 to 001-411): `squeal failures`
"lists failures still stored, not every failure ever seen". C7: "Results under one key are shared
by every worktree with that key: the newest run from any worktree replaces the stored outcome". C5:
"The retry's result replaces the stored row for every worktree at that key (D8). A pass is
delivered `FAIL -> PASS` with the flaky note". Acceptance criteria 1 and 2 of the issue contradict
the first sentence and need a C6 amendment, a C5 amendment, or both. `status.md` records no decision
on keeping replaced failures.

## Recommendation for Squeal

Triage this as a spec change, not a bug fix. The product does what C5 to C7 say. The cheapest fact
for a decision is Q3: the store already holds the run, its log and its load. Losing them at
retry time is a missing link (the flaky note drops the replaced row's provenance), and losing them
later is the prune rule for unreferenced runs. Whichever option the coordinator puts to the human
has to say whether a replaced failure stays referenced, so prune keeps its run and log, and whether a
second flip of one check keeps the first (Q5). No design is offered here.

## Open questions

- The incident store was not replayed (Q7), so it is not confirmed that cezarion's two failures had
  different keys. The issue's revisions 1 and 2 suggest they did.
- Whether `auto-resume.test.ts` and `harness-autosave.test.ts`, named in the issue, went through the
  same retry path or a 001-171 re-run was not determined, because their store was not read. Either
  path replaces the row the same way (C5).

## Experiment record

- Host load immediately before each live run, one-minute against `nproc` 24: 15.27 at
  2026-10-20T16:43:47Z and 15.26 at 16:43:58Z (both below 24). The first run printed no console
  output, so it was repeated with `--silent=false`. No CPU stress was created; the 3.33 and 0.50
  per CPU are injected.
- Commands, from the worktree root: `npm ci --no-audit --no-fund` (the worktree had no
  `node_modules`; gitignored), then
  `npx vitest run --config docs/specifications/011-core/research/probes/issue-54/vitest.config.ts --maxWorkers=1 --silent=false --reporter=verbose`.
  1 test passed, 2.65 s. The fixture's temp repo under `test/fixtures/scheduler/.tmp` is removed by
  the harness, and the captured log was deleted after it was copied into `output.txt`.
- No full suite, build or typecheck was run (docs-only task).

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/54 (read via `gh issue view 54`)
- `docs/specifications/011-core/spec.md` C5, C6, C7; `docs/specifications/011-core/status.md`
- `src/core/store/schema.ts`, `src/core/store/repos/results.ts`, `src/core/store/prune.ts`
- `src/core/state/flaky.ts`, `src/core/state/rerun-first.ts`, `src/core/retry/load.ts`
- `src/core/status/failures.ts`, `src/core/status/why.ts`, `src/core/status/format-why.ts`
- `test/scheduler/retry-fixture.ts`, `test/scheduler/helpers.ts`
- Probe: `docs/specifications/011-core/research/probes/issue-54/` (`probe.test.ts`, `vitest.config.ts`,
  `output.txt`, `README.md`)
