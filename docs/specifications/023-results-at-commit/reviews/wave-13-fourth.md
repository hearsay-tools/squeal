# Wave 13 fourth review: project identity

PASS 903f185d52aba7b60f63e436ffa952a1c3ec7347

Zero blockers, should-fix findings or nits in this bounded review. The completion record now preserves each project's outcome. The save-moment gap remains, as the human accepted, and its report states the uncertainty. B1 and B3–B5 remain closed. No product code was changed.

This review follows `wave-13-third.md` (report commit `6f7fcbc2e`) and the human's 2026-11-19 choice, “A: key per project”. It covers `9cfdf990c..903f185d5`, including repairs, notes, tests and bundles. The human accepted the third review's second finding as a documented limit; this review checks its wording rather than requiring a transactional store/record write. Exact candidate: `cand/0.1.564`, `903f185d52aba7b60f63e436ffa952a1c3ec7347`.

## Verification

Code checks and probes ran before adding this report. The exact candidate's tracked tree was clean; the build left no drift. Dependencies were supplied by Squawk; installation was not repeated. No local full suite ran.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch`; `git checkout --detach 903f185d52aba7b60f63e436ffa952a1c3ec7347`; `git rev-parse HEAD`; `git status --short` | Exact candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3746 files in 1292ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; four plugin builds completed; no drift. |
| Focused Squeal wait below | First wait returned exit 3 after 60.8 s with an older daemon revision; not current evidence. Second wait exited 0 after 2.7 s: all eleven files current at revision 15, no known failures. Whole worktree: 118 of 1995 not current, all queued, 647 tests queued. |
| Gate/daemon seam Squeal wait below | Exit 0 after 14.0 s at revision 15: all eight files current, no known failures. Whole worktree: 117 of 1995 not current, all queued, 641 tests queued. |
| Broader `squeal status --wait 60000`, before this report | Timeout after 60.7 s: 118 affected files pending at revision 15, no known failures. All were queued. This is incomplete affected coverage. |
| Final `squeal status --wait 60000`, after adding only this report | Timeout after 61.0 s at revision 17: 94 of 117 affected files pending, no known failures. Whole worktree: 94 of 1995 queued, 494 tests queued. The dirty path was this report; product content was unchanged. This remains incomplete coverage. |
| Independent probes | Ten valid jobs exited 0: `two`, `three`, `listed-twice`, `concurrent`, `off`, `grown`, `gap`, `checks`, `scope`, `proof`. One invalid setup attempt, `duplicate`, exited 1 before running tests; see below. |
| `timeout 600 pnpm run check:private`, before this report | Exit 0: `6686 added lines in 87 files over 1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca, ok`. Warning: empty private denylist; that rule was skipped. |
| `timeout 600 pnpm run check:private`, with this report committed | Exit 0: candidate plus report checked, 88 files. Empty-denylist warning remains. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44465322318) | In progress at the last read before filing: Node 24 lint/typecheck/version-sensitive job passed; six Node 22/26 shards running. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44465322295) | Completed successfully at the exact candidate. |

The focused waits used the session launcher (home paths shown with `~`):

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-review13-projects.test.ts \
  test/cli/status-at-review13-maybe.test.ts \
  test/cli/status-at-review13-b2.test.ts test/cli/status-at-review13.test.ts \
  test/cli/status-at-run-budget.test.ts test/cli/status-at-paths.test.ts \
  test/cli/proof-control.test.ts test/cli/proof-conditions.test.ts \
  test/cli/proof-report.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts

~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/code-gate-files.test.ts test/cli/code-gate-stored.test.ts \
  test/code/gate/collect-lanes.test.ts test/code/gate/keep-early.test.ts \
  test/code/gate/keep-grown.test.ts test/code/gate/keep-daemon.test.ts \
  test/code/gate/keep-daemon-wire.test.ts test/code/gate/lanes-retry.test.ts
```

Squeal's revision-15 header displayed `903f185d + 2` after build writes. The final Git check still identified the exact candidate with no tracked diff. The named current results above do not establish that the queued files passed.

Each probe ran as a Squawk job with `timeout 600 node --import ./node_modules/tsx/dist/loader.mjs --disable-warning=ExperimentalWarning "$TMPDIR/w13q.mjs" <case>`. It used real Git fixtures, throwaway HOME directories, caches and markers under `$TMPDIR`. Source commands came from the candidate; gate children used its committed Claude Code bundle. The installer linked the candidate's Vitest; frozen installation was not independently tested. Multi-batch checks set `batchFiles: 1`. Production batch sizing was unchanged. One independent full proof ran. The optional e2e suite was not repeated.

All eleven jobs exited. Fixtures checked their Git worktree counts and removed their directories; the concurrent fixture removed its linked peer. A final process scan found no fixture process or fixture directory. The probe script was removed before committing.

## B2: project conflation is closed

The repair carries `{ ref, evidence }` through `CollectOptions.ended`. `progressHooks` keys completed runs by runner, project and path. Kept keys and not-kept reasons retain project identity. Recovery matches a project-qualified run or reason only to that project. Normal answers still carry unqualified outcomes and retain the conservative disagreement rule. No newest-key lookup or provenance search was reintroduced.

The two-project fixture repeats the third review's failure: coverage off, one path, `pass` and `fail` Vitest projects with opposite setup values, and a teardown held for 600000 ms. Run `status --at HEAD --run --all-missing --timeout 20 --json`.

| Fixture | Stopped result | Normal-answer control, after removing the hold |
| --- | --- | --- |
| Two projects, commit `b1dd59be9ded88fd7306307d3acee74f802c4ec5` | After 19.386 s: `pass` passes; `fail` fails with `failed: ["mode"]`. `ran: 2`, `stored: 0`, `notRun: 0`. Each has the coverage-off reason. | Commit `d5f0f079dcac26f4175952da55a3b1e3410bd2db`, 0.937 s: both `not determined`, `its 2 projects ended differently, and no result was stored to tell them apart`. |
| Three projects, commit `f02cca2881cd9195192b005fe702b3a41dbb8ac3` | After 19.423 s: correct pass/fail/fail across `pass`, `fail`, `third`. `ran: 3`, `stored: 0`, `notRun: 0`; correct reasons. | Commit `16870685f05dbf0c70cff05199dbfa2632b6260d`, 0.967 s: all `not determined`, with the three-project disagreement reason. |

For a project listed twice, an adapter proxy duplicates only the passing project's real Vitest `testFiles()` entry: `[fail:a, pass:a, pass:a]`. `runGateFiles` runs against the real adapter in a real Git fixture. The completion record has exactly two entries, one correct failure and one correct pass, each project-qualified. Repeating one project's listing does not erase the other project's outcome. This is an adapter-list seam injection, not a claim that Vitest accepts duplicate configured project names.

An initial config with two projects named `pass` was invalid: Vitest rejected it with `Project name "pass" is not unique. All projects should have unique names.` No tests ran in that attempt. It is not evidence of a candidate regression.

## Accepted save-moment gap: wording is honest

The documented limit in `tasks/023-19-notes.md` matches the implementation. A store write can land before its confirmed-keep record is published. The previous whole record then proves completion but cannot prove storage. JSON retains `origin.stored: false`; `run.stored` counts confirmed keeps only. This representation is the accepted scope, not a new claim that the result is absent from the store.

The deterministic `gap` probe intercepts only the next `at-run-record.json.next` write that contains a confirmed keep. It writes a 13-byte invalid prefix and blocks until the hard stop. The published prior record remains whole, with the completed pass and no kept entry. At fixture commit `70576fd8a432e82c942e305cca4acdb5d1015016`, the stopped report retains the pass after 19.497 s and states:

- Reason: `the run was stopped at the budget before its record said whether the gate kept it; it may have been stored, and the next status --at shows it`.
- File text: `run by this command; it may have been stored, and the next status --at shows it`.
- Run line: `1 not known to be stored (...)`, with no assertion that the next lookup has no result.

The immediate lookup exits 0 and reads the stored pass at the proposed kept key `df0a54a3…`. No torn JSON is consumed. The test demonstrates the accepted gap and the corrected text. It does not claim that ordinary record writes take 20 s. The new focused wording test is current and passing.

## Earlier cases and brief regression

- **Concurrent writer:** two linked worktrees share one store. A (`85d1a8be6f109d4ec0b1b6c32ebb829eb2151d8f`) stores a grown-key pass at `43aacff4…` and holds its close. B (`aaa4ce81b9d3dd8e92a2a08e0fd5103b8e9c076f`) writes a newer failure at `c9155641…`. A stops after 29.348 s and reports its own pass, stored, `ran: 1`, `stored: 1`. Its next lookup agrees. B's newer failure remains correct.
- **Coverage off:** the held completed pass survives after 19.421 s, with its coverage reason, `ran: 1`, `stored: 0`, `notRun: 0`.
- **Grown key and stopped first batch:** after 19.387 s the pass is reported stored at actual key `80691b35…`, distinct from pre-run key `ebefafc2…`; the next lookup agrees.
- **B1/B3:** three one-path batches. The first starts an interval child and changes tracked source. The second verifies that child is absent or a zombie before completing. Later two files read `not comparable`, `ran: pass`, `changedBy: run`; only the first stores. Total 3.695 s. Final cleanup leaves no fixture process.
- **B4/B5:** disjoint source closures select, run and store only A; B's marker is absent. After changing A's import and seeding its current failure, selection by the old source retains the correct current failure and pass-to-fail comparison.
- **023-20/P9:** one dependency proof has conditioned red assertion failure, green pass, and unconditioned red assertion failure. It exits 0, `proven`, says `red without them too` and that the conditions are not shown to matter. The control stores; conditioned sides do not. Three runs, 5.098 s. This preserves the settled proof meaning.

The gate's optional completion listener still leaves ordinary answers unchanged. Existing path-level not-kept reporting remains in place alongside the added project map. Current gate/daemon seam tests support unchanged callers. No new store policy, daemon protocol, run scheduling or batch-sizing change appeared in this delta.

## Input for integration

B2's remaining project-identity blocker is closed. Retain the accepted save-moment limit and its uncertainty wording. No repair wave is needed from this review. Broader queued checks and full-suite CI remain verification limits; this bounded PASS is not release evidence for an unfinished CI run.
