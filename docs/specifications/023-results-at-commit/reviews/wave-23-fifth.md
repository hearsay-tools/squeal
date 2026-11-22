# Wave 23 fifth review

PASS `2b8d9297cfe2bd10339ca9e8ec1cd054472e4a17`: **0 blockers, 0 should-fix findings, 0 additional notes**.

Candidate `cand/0.1.594`. HEAD matched. This review is bounded by `wave-23-fourth.md`: its two blockers, the strict-rule revert, the remaining-deadline repair, and the rebase onto main 0.1.593. The human's 2026-11-22 decision is "Strict rule only". Both prior blockers are closed. Only this report is committed.

## Verification

Heavy checks and fault probes ran in an isolated sandbox. The archive and commit object reconstructed the exact candidate, tree `d62899c2ff532d0569dfca85e17edad8cc836738`. Node was 24.22.1; Corepack selected pnpm 12.15.0. Prepared local dependencies were left alone. No full suite ran.

| Check | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0, 3.9 s. |
| `pnpm run lint` | Exit 0; 4,003 files checked, no fixes. One warning and two infos. |
| `pnpm run typecheck`; `pnpm run build` | Both exited 0. Tracked tree stayed clean; no bundle drift. |
| Targeted command below | **22 files, 93 tests passed**, exit 0, 130.18 s. A transient transport 502 hid the first response; the stored command history supplied the completed output and exit status. No duplicate run. |
| Supplemental fourth-review witnesses | **2 files, 2 tests passed**. Two real lock owners; real SQLite contention and a stopped writer. Details below. |
| Red controls | Old lock code: committed held-places-lock test times out at 5 s. Old option B: busy/stopped-writer witness fails because C walks nothing and loses the manifest. Both exit 1 for the intended reason. Sources restored; `git diff --exit-code` passes. |
| Installed Squeal `checks`; affected path waits | See the affected snapshot below. No full-suite checkpoint requested. |
| Installed Squeal key-format path wait | At revision 15, `test/keys/key-format.test.ts` had a current result and no known failures, after 54.0 s. |
| Exact-candidate CI | [CI 44997901440](https://github.com/hearsay-tools/squeal/actions/runs/44997901440) remained in progress. Its Node 24 lint/typecheck/version-sensitive job passed. [Private material 44997901512](https://github.com/hearsay-tools/squeal/actions/runs/44997901512) passed. Full-suite CI remains unverified. |
| Performance | `tasks/023-40c-measure.md` measures the earlier `d0925e820` bundle. It does not measure this strict rule. The coordinator confirmed no newer completed measurement; an exact-candidate measurement is separate work. Strict-rule performance and the per-release benchmark comparison remain unverified, not findings. |

Affected-path command:

```sh
squeal status --wait 60000 \
  src/core/checkout/commit-worktree.ts \
  src/core/scheduler/proven-walks.ts \
  test/cli/status-at-kit.ts
```

The first two affected waits returned exit 3 at revision 15. The second snapshot was **526 selected files pass, 209 pending**. A final wait, with only this report added, returned exit 3 at revision 17 after 60.5 s: **639 selected files pass, 96 pending**. Whole worktree: zero known failures, 192 of 2,123 test files not current. Affected verification remains incomplete; these counts do not claim those pending files passed.

Targeted command, with pnpm selected through Corepack:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/checkout/deadline.test.ts \
  test/checkout/commit-worktree.test.ts \
  test/cli/status-at-now-daemon.test.ts \
  test/cli/status-at-setup-bound.test.ts \
  test/cli/status-at-deadline.test.ts \
  test/cli/status-at-commit-daemon.test.ts \
  test/cli/status-at-commit-refused.test.ts \
  test/cli/status-at-run-gitattributes.test.ts \
  test/cli/status-at-not-selected.test.ts \
  test/cli/status-at-call.test.ts \
  test/cli/status-at-call-after.test.ts \
  test/cli/status-at-join-recorded.test.ts \
  test/cli/status-at-stopped.test.ts \
  test/daemon/at-asks.test.ts \
  test/scheduler/proven-walks.test.ts \
  test/scheduler/proven-walks-unresolved.test.ts \
  test/scheduler/proven-walks-status-at.test.ts \
  test/scheduler/changed-selects.test.ts \
  test/fixed-version.test.ts \
  test/version-sensitive.test.ts \
  test/keys/check-key.test.ts \
  test/keys/closure.test.ts
```

The acceptance run used unchanged candidate product sources. Supplemental probes and controls were separate. Daemon tests await readiness or quiet points. The configuration test uses a barrier. The two-lock probe's deliberate 70 s hold exercises serial waits; it does not guess when a daemon is ready.

## B1 closed: both creation locks use the remaining deadline

**Locations:** `src/core/checkout/commit-worktree.ts:170`, `:205`, `:233`.

`remainingWait` cuts the outer checkout lock to the absolute deadline on each loop. After that lock and the existing-worktree search, the inner places lock computes its allowance again. Time already spent on the first lock is deducted. Calls without a deadline keep their previous lock policy.

Repeated the fourth review's production-boundary witness: acquire the fixture's real checkout lock and the real places lock before a default `status --at A test/a.test.ts --run --json` call. Release the checkout lock after 70 s. Keep the places lock held until the call returns. Use production `realDaemons().commit`, worktree creation and locks; stand-ins answer only the working-tree side. No commit daemon is reached.

```text
elapsed:                 98065 ms
run.waitMs:              100000
run.usedMs:              98057
inner lock allowance:    27967 ms
exit:                    3
run.commit.tree:         null
worktrees made:          0
```

The report says the call's wait ended while the commit worktree was made, naming the held places lock. The earlier candidate took 130,092 ms in this state. This candidate returns within the call's bound, with its report reserve intact.

The committed short-deadline test passes in 1,581 ms with a 1,500 ms deadline. Restoring only the pre-fix `commit-worktree.ts` makes that same test time out at 5 s. The earlier deadline tests also pass: package-store query, worktree-add hook, full ceiling, install, install lock, late worktree start, unclaimed daemon ownership and shared group allowance.

The current-side configuration barrier test passes at the default 100 s wait. Its follow-up reads both sides in the same call after setup ends, including the tracked runtime read at its completed key. The independent real commit-daemon observed-input regression also passes. These earlier B1/B3 boundaries stay closed.

## B2 closed: an absent listed path forces a walk

**Locations:** `src/core/scheduler/proven-walks.ts:68`, `:91`; `src/core/scheduler/bootstrap.ts:199`.

Option B and its independent writer-key inference are gone. A stored walk proves a miss only when its key exists and its list has no absent path, apart from the default snapshot path. The absent test reads the same hash source as the key index. Directory listings stay represented in the key. The default snapshot path is fixed by the test path; moved snapshot paths receive no exception. No key encoding changes.

Repeated the fourth review's nested-manifest fixture and persistent window, without rewriting a key row:

1. A walks at K and retains its registered row and walk. Its closure contains absent `src/package.json` and `src/deep/package.json`.
2. B starts at A, closes, adds the deeper manifest that redirects `#foo`, then restarts.
3. Another actual SQLite connection holds `BEGIN IMMEDIATE` at `commitFirst`. The scheduler gets actual `SQLITE_BUSY`, error code 5. Release that connection. B's stored row remains K.
4. B commits its newer closure list, which omits `src/package.json`. Stop it immediately after that transaction and before the final ledger commit.
5. Start C at A. B's list keys at K here, but its absent manifest now forces a real walk.

Observed on the candidate:

```text
B stored key:                         K
C completed key:                      K
C walked files:                       [test/foo.test.ts]
C closure contains:                   src/package.json
changedSelects([src/package.json]):    [test/foo.test.ts]
closureReads(src/package.json):        src/package.json
```

Restoring option B in `proven-walks.ts` and its bootstrap call reproduces the defect with the same real contention and stop: C walks `[]`, its closure lacks `src/package.json`, selection is `[]`, and refusal reads are empty. The probe fails its walk assertion. Restored candidate sources pass.

The ordinary three-worktree test and the public real-daemon case pass too. The latter refuses the untracked candidate under D4.9, then selects and runs the test when the candidate is committed. The equal-byte, changed-file and different-key tests still pass. Reuse remains where its proof holds; lists with absent inputs pay for a walk. The removed writer guard's persistent-window and graph-pruning arguments no longer decide reuse.

## Rebase and earlier protections

`git range-diff 9c9798c6a..9786300df f66d0ae7c..7e47fb393` pairs all eight fourth-round commits. Seven patches are equal. The daemon-read patch loses the `VERSION_ARGS` import that main added. Final commit `2b8d9297c` restores it. HEAD contains both the import and `...VERSION_ARGS` in `RELAUNCH`.

The full candidate rebase comparison, `d05244033..9786300df` against `4296972c7^..7e47fb393`, pairs 58 commits: 54 equal. The four changed patches are two helper-import contexts and two regenerated bundle/version patches. The sole source/test path changed on both main and the candidate is `test/cli/status-at-kit.ts`. Main's store-prune changes remain intact. The clean build and version-sensitive tests pass on the combined tree.

The targeted regressions preserve the earlier review's settled behavior: exact daemon keys, same-call observed-input results, recorded-request joins and Q7, stop marks and command holds, whole-checkout checks, generated-input refusal, incomplete-closure markings and the live-count memory ceiling. No new blocker was found at the changed boundaries.

## Inputs for the next step

No correctness repair is required by this review. Keep the strict absent-path rule and the absolute deadline at each lock acquisition. Require passing full-suite CI on the exact release commit before release. Report strict-rule performance from its separate measurement; the earlier measurement is not evidence for this candidate.
