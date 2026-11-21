# Wave 20 re-review

FAIL `bff830405ae8a6c6e44b76a58b201a294a477428`: **2 proven blockers remain**, B4 and B8. B1–B3, B5–B7 and N1 are closed. One new proven verification defect is recorded as a nonblocking note under the bounded re-review rule.

Reviewed the repair delta `126acb669..bff830405`, against the original review at `8968642f3:docs/specifications/023-results-at-commit/reviews/wave-20.md`. That file is absent from this candidate. Fetched the candidate and checked out `origin/cand/0.1.586` detached as requested. HEAD matched the requested SHA. Generated bundle content was excluded from review.

## Verification

Used the reviewer skill. Read the prior findings first, the updated row notes, and wave-20's brief and contracts. Retained the original review's process, vision, styleguide, D4 step 11, D6 and Round 5 T1–T6 scope. Reviewed the approved spec 011 scheduler and daemon repairs as product code, including the owner/lead/at merge through protocol, handlers and both desk modes.

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Used the installed dependencies. No install repeated. |
| `git rev-parse HEAD`, `git status --short` | Exact requested candidate; clean before verification and after removing all probes. |
| `pnpm run lint` | Exit 0: 3,947 files checked, no fixes. One existing `noProto` warning and two literal-key infos in unrelated tests. |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Exit 0, all four plugin builds. No tracked change. |
| `pnpm run check:private` | Exit 0: `14150 added lines in 118 files over bc30db2a6b0537c89ba12ba7c6a2d50ef1026a24, ok`. The empty private denylist was skipped with its warning. |
| Installed `squeal checks` | Default tests, 2,092 files. Typecheck, build and excluded e2e files are outside its coverage. |
| Initial installed Squeal path wait on scheduler/daemon source paths | Exit 3 at revision 16: 299 selected files current and passing, 398 pending. This was incomplete affected evidence. |
| Clean targeted command below | Exit 1: **24 files passed, 1 failed; 172 tests passed, 1 failed**, 56.58 s. The sole failure is N2 below. |
| Final focused installed `squeal status --wait 60000` | Exit 1 at revision 20: ten named files each had a current result; one known failing test, N2. The worktree still had 116 of 2,092 files not current: 115 queued, one unknown. No whole-worktree pass is claimed. |
| Exact-candidate CI | [CI 44900758363](https://github.com/hearsay-tools/squeal/actions/runs/44900758363) remained in progress at the last read. Full-suite evidence is unverified. [Private material 44900758347](https://github.com/hearsay-tools/squeal/actions/runs/44900758347) passed. |
| Benchmark comparison, process 6c | Unverified. No base/candidate comparison is supplied; the row notes still say no benchmark ran. This is not a blocker. |

Direct Vitest runs used `timeout 600 pnpm exec vitest run --maxWorkers=2` and explicit paths. The concrete failure probes and pending affected results justified those runs. No full suite ran. `squeal.config.json` stayed unchanged.

The clean-tree targeted command was:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/cli/status-at-not-selected.test.ts test/cli/status-at-report-files.test.ts \
  test/cli/status-at-run-cold.test.ts test/cli/status-at-run-fit-check.test.ts \
  test/cli/status-at-run-give-back.test.ts test/cli/status-at-run-marks.test.ts \
  test/cli/status-at-run-unkept.test.ts test/cli/status-at.test.ts \
  test/cli/stop-run-groups.test.ts test/daemon/run-group-paths-at.test.ts \
  test/daemon/run-groups-watch.test.ts test/daemon/run-groups.test.ts \
  test/daemon/take-back.test.ts test/scheduler/take-back.test.ts \
  test/scheduler/take-back-owners.test.ts test/scheduler/take-back-lead.test.ts \
  test/scheduler/narrow-run.test.ts test/scheduler/narrow-run-promotes.test.ts \
  test/scheduler/request-intake.test.ts test/scheduler/promotions-published.test.ts \
  test/harness/skill.test.ts test/runners/observe/spawn-run-group.test.ts \
  test/runners/boundaries.test.ts test/version-sensitive.test.ts \
  test/keys/key-format.test.ts
```

The final Squeal wait named the three `take-back*.test.ts` files, `run-groups-watch.test.ts`, `run-groups.test.ts`, `run-group-paths-at.test.ts`, `status-at-not-selected.test.ts`, `status-at-run-unkept.test.ts`, `key-format.test.ts` and `version-sensitive.test.ts`.

Throwaway probes imported unchanged candidate product code. The first command ran two independent probe files and eight candidate test files: 43 tests passed and the B8 assertion failed, 19.65 s. The B4 rate probe then failed its guarded-completion assertion after its bypass control passed, 87.23 s. These expected failures are evidence for the blockers, not unexplained candidate test failures. Temporary node:test probes also caused the version-sensitive-list check to fail; removal restored that check. All three probes were deleted before the clean targeted run. N2 persists without them.

## Prior findings checked

| Prior finding | Result and witness on this candidate |
| --- | --- |
| B1: edit-required work lost | **Closed.** Independent real-scheduler witness: 14 manual-group files, one held running, ten queued files' separate imported sources edited in one revision. Take-back returned `{takenBack:3,running:1,kept:10}`. Exactly the ten edited files remained queued. Candidate tests also pass for shared-source readers, including demoted readers. Independent queue controls kept a forced entry and detected another wait's promotion. Ordinary `RunQueue.add` clears exclusive owners regardless of rank. |
| B2: named request behind wide request | **Closed.** Independent real-scheduler witness: queue five files, hold the first, then name the last file with a new owner and `lead:true`. Nothing interrupts the first tier; releasing it starts the named file second. The candidate tests also check successive leading subsets and ordinary wait order. |
| B3: pending request queues after take-back | **Closed for queue cancellation.** Hold the runner's `affected` answer during a narrow source-path request. Take its owner back before releasing intake. The scheduler returns `queued:0`; take-back counts are all zero and no file runs. The CLI test retains that owner when intake misses the deadline and sends it to take-back. B8 is the remaining cleanup-policy seam on this same path. |
| B4: false cannot-fit refusal | **Still open.** The uniform fast cold selection now succeeds, including the independent 16-file, width-one, serial node:test witness. The new heterogeneous witness below still suppresses an answer that fits. |
| B5: dirty inputs called equal | **Closed.** Independent end-to-end witness: base node:test imports a source; HEAD changes only README; leave the source dirty. The file stays unknown and the report says uncommitted changes may reach it. It never says `cannot change`. Candidate tests pass for staged and unstaged imports and an unrelated-dirty control. Incomplete closures and missing completeness lists retain their separate exceptions. |
| B6: reused group with missing newer leader | **Closed.** Re-ran the deterministic original identity case through `stopRuns`: stale group 100/start 50, only unrelated member 101/start 95 alive. No signal is sent; the process is spared and named. Token-less reused leaders and other-run carriers survive. Per-PID start checks remain in `terminate`. |
| B7: detached child outlives fast starter | **Closed under the chosen option A contract.** The real no-delay node:test starter uses `detached:true`, `env:{}` and `unref()`. Its child is gone and named when the flagged run returns. Ordinary-run, outside-process and other-run controls survive. The observe recorder's sync/async empty-env token tests also pass. The token is recorded before the run. The stated limits for programs that clear the mark, pytest and missing recorders remain. |
| B8: cleanup applied to ordinary run | **Still open.** Rejected unknown requests no longer flag paths, project identity is preserved, and an already accepted owner's flags clear on take-back. A cancelled request that finishes intake later restores its flags; see below. |
| N1: stored/parts producer called this run | **Closed.** `unkeptNow` now requires every contributing outcome to have `from:"run"`. The stored/parts controls produce no this-run state; the run control does. The real two-sided unkept fixture compares and stores nothing; its next lookup has no result. Existing one-sided marker tests pass. |

## Remaining blockers

### 1. B4: the first batch's rate still refuses an answer that fits — proven

**Locations:** `src/cli/status-at-run-fit.ts:91`, `:99`; `src/cli/status-at-run.ts:289`, `:295`.

T1 permits a refusal when a selection clearly cannot fit. The review brief expressly requires that this refusal never hide an answer that would fit. A single batch's mean time, including its child startup, does not bound the remaining files' cost. This repair replaces the unsupported fixed floor with an unsupported extrapolation.

**End-to-end witness:** use an empty-store git fixture, coverage off, 16 node:test files importing one changed source. Mock the parent's `availableParallelism()` to 2, giving batch width one. Give the node:test child `--test-concurrency=1`. Only lexically first `test/r00.test.mjs` waits 21 seconds; the other 15 tests return at once. Both versions pass. Use a 300-second budget for both calls.

- With `fitCheck:true`, the call ends in **25.598 s**. One commit-side file ran, no working-tree file ran. It reports `0 unchanged, 16 unknown` and: `at the rate it measured, the rest clearly do not fit the 300 s budget`.
- With `fitCheck:false`, the same selection completes both sides in **58.567 s**: `16 unchanged, 0 unknown`. Coverage is off, so the first call stored nothing for this control to reuse.

The existing two-fast-file cold test cannot distinguish this defect. The guarded call even offers a 600-second rerun while the full answer takes less than one minute at the original budget.

**Repair:** treat this sample as an estimate, not proof that execution cannot fit. Continue within the budget unless the refusal has evidence that is safe for the remaining selection. Preserve completed outcomes, the shared budget and forcing text. Add this slow-first/fast-rest refusal-versus-completion control. Do not require the user to override an incorrect refusal to obtain the answer.

### 2. B8: a cancelled request restores cleanup flags after take-back — proven

**Locations:** `src/core/daemon/daemon.ts:1202`, `:1271`; `src/core/daemon/run-groups-watch.ts:80`, `:87`; cancelled answer in `src/core/scheduler/narrow-run.ts:160`.

T3 limits cleanup to flagged `--run` work. `flagAccepted` treats the presence of `narrow` as acceptance and flags every selected file. A cancelled narrow request also returns `narrow.selected`, with `queued:0` and a not-run reason. `AtRunRequests.takenBack` only deletes the current map entry. It does not prevent a later acceptance callback from recreating it.

**Real-scheduler seam witness:** use one manual-group file importing a source. Wire the exported `requestGroup` and `flagAccepted` in the same awaited order as `Daemon.#requestGroup`. Hold `runner.affected` while requesting the source with `{owner:"late",at:true}`. While intake waits, perform the exact `Daemon.#requestTakeBack` order: `requests.takenBack(["late"])`, then `scheduler.takeBack(["late"])`. Release the runner answer.

The scheduler correctly answers `queued:0`, and take-back returns `{takenBack:0,running:0,kept:0}`. No run started. But the pending `#requestGroup` continuation then calls `flagAccepted`; `requests.flagged([file])` is **true** after both operations settle. A later ordinary run therefore enters `withRunGroups`' marked branch and records/stops its children. There was no surviving flagged queue request for that run. This is the same policy leak as B8, reached through the repaired cancellation seam rather than an unknown group.

The independent positive control also checked the first accepted run: its runner call saw the flag already set. No first-run ordering failure was observed.

**Repair:** reject late acceptance for an owner already taken back, and flag only work actually accepted for that owner. Preserve the cancellation decision across the scheduler answer and daemon continuation. A `narrow` response alone is not that decision. Cover cancellation while intake waits, refused/not-run answers, and a later ordinary run; retain the project/path and first-run controls. Do not clear a token from a run that has already started and still needs its own cleanup.

## Repair-regression note

**N2 — proven, nonblocking in this bounded re-review:** `src/runners/node-test/runtime/recorder.cjs:207` adds a conditional token/spawn path that none of the validity cases executes. `test/keys/key-format.test.ts:34` fails on the clean candidate with `NODE_TEST_ADAPTER_VERSION ... changed lines no case runs`, listing runtime lines 207–240. Squeal reports the same test-level failure. This is independent of the removed probes.

Add a focused case under `test/keys/validity/cases/` that exercises the marked recorder path and establishes its key/version effect. Do not silence the alarm or bump an adapter version without the required comparison. Re-run the focused key-format check and obtain exact-candidate CI. This note does not infer a product key defect from missing test coverage.

## What fits and next-wave inputs

The owner/lead/at values reach the main thread in both desk modes and in the right argument order. The new queue ownership guards preserve catch-up and demoted edit work, forced work and other waits. Later named requests lead the next boundary without cancelling a running tier. Keep these repairs.

T2's dirty reach is conservative on a failed git/runner read and preserves incomplete/unchecked exceptions. T4's producer check, two-sided comparison and never-stored behavior pass. T5's one-line exit-2 text and T6's common 360-second tool-timeout advice remain intact; their tests pass.

Keep the approved token mechanism and the rule against path or command-line matching. `squeal stop` names the token carriers it ends and uncertain recorded-group members it spares. The old-daemon fallback remains explicit; additive narrow options do not stop old daemons from running work.

Dispatch B4 to the CLI owner and B8 to the accepted-request/daemon owner, with the cancellation witness spanning both row 023-34 and row 023-36. The queue-cancellation fix itself must remain. Supply the N2 validity evidence and the missing benchmark comparison. Exact-candidate CI is still required before release; this review does not claim it passed.
