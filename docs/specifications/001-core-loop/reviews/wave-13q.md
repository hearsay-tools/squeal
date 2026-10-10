# Wave 13q: per-revision discharges (001-213)

## Verification output

Candidate: `38f2aadb8858628bb04a43e0fdc70a04c1c9eb9a`, package 0.1.94, the assigned HEAD. Reviewed range: `b7c0206a^..f8f99207`, 001-202 and its 0.1.90 rebuild, read against today's main. The later scheduler delta through 001-205 and 001-210 is inspected for effects on this attribution contract. This is bounded by `reviews/wave-13l.md` S1 and the three questions in row 001-213. No product code changed. The tracked tree was clean for all checks and probes, before this report was written.

Linux; Node 24.21.0 and 22.23.3. The human explicitly forbade the build and then waived this reviewer's independent full suite. The already-running full suite was stopped with SIGINT, its process exit was 130, and its processes exited. It produced no final summary and supports no verdict. Build reproducibility is **unverified**. Both committed CLI bundles contain the per-revision map and the same pruning logic as the sources; this source inspection is not a build check.

Whole-tree evidence supplied by the human for the coordinator's gate at executable commit `89429af0` (0.1.94): **2,407 passed; three load timeouts in turn, user-prompt-submit and graph-cost passed alone**. This is coordinator evidence, not an independent run by this reviewer. `git diff 89429af0..38f2aadb --stat` names documentation only.

```text
$ git rev-parse HEAD
38f2aadb8858628bb04a43e0fdc70a04c1c9eb9a
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; optional @parcel/watcher and esbuild install-script warnings)

$ npm run lint                         # Node 24.21.0
Checked 744 files in 268ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.94 typecheck
> tsc --noEmit
(exit 0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run lint
Checked 744 files in 302ms. No fixes applied.
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run typecheck
> squeal@0.1.94 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run <12 scope files below> --maxWorkers=2
Test Files  12 passed (12)
     Tests  60 passed (60)
Duration 72.99s
(exit 0, Node 24.21.0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run <9 scheduler/sync files below> --maxWorkers=2
Test Files  9 passed (9)
     Tests  24 passed (24)
Duration 41.06s
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run <3 CLI files below> --maxWorkers=2
Test Files  3 passed (3)
     Tests  36 passed (36)
Duration 26.03s
(exit 0)

$ node node_modules/vitest/vitest.mjs run --config <external>/probes.config.mts
Test Files  1 passed (1)
     Tests  4 passed (4)
Duration 35.64s
(exit 0, Node 24.21.0; assertions reproduce eviction and its controls)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH node node_modules/vitest/vitest.mjs run --config <external>/probes.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  4 passed (4)
Duration 17.45s
(exit 0; same observations)

$ node node_modules/vitest/vitest.mjs run --config <external>/mutation.config.mts --reporter=verbose
FAIL later cached discharge: expected 'quiet' to be 'news'
PASS one-discharge control
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
Duration 21.92s
(expected exit 1, Node 24.21.0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH node node_modules/vitest/vitest.mjs run --config <external>/mutation.config.mts --reporter=verbose
FAIL later cached discharge: expected 'quiet' to be 'news'
PASS one-discharge control
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
Duration 18.25s
(expected exit 1)
```

The nine scheduler/sync files are `test/scheduler/{discharges,later-discharge-wait,resolved-wait,environment-growth-same-revision,environment-growth-wait,environment-growth-siblings,rekeyed,claims-finished}.test.ts` and `test/daemon/sync.test.ts`. The three CLI files are `test/cli/{status-wait,status-wait-window,status-wait-edit}.test.ts`. Thus both Nodes ran the same 12 files and 60 tests. Node 22 emitted experimental SQLite and proxy-agent warnings.

The fix-removal mutation ran the existing later-discharge test's two cases from an external copy. It replaced `Discharges.note` and `since` in that process with the pre-fix last-entry-per-file behavior from `b7c0206a^`, retaining the same earliest/latest revisions and time filters. No repository source or bundle was reverted. Both Nodes reproduced quiet, zero own transitions, two edit files and one other transition for the cached case; the control returned news, one own transition, three edit files and zero other transitions. The unmodified implementation passes both cases in each Node's scope gate. This isolates per-revision retention from all later scheduler changes.

The eviction probes use the real adapter, scheduler, store, sink and public `waitForStatus`, with the daemon's capture/refined/rekeyed sequence from the existing regression. They instrument `Discharges.note` to obtain the live instance, then feed synthetic discharge entries to that instance while strings' refinement is held. The age probes advance discharge timestamps; they do not spend an actual hour waiting. The count probes use the real default 10,000-entry bound, not a reduced test cap. They prove the pruning and consumer effect, not that a 10,000-file project or an hour-long sync was run. The exact inputs and observations are below. All temporary probes were outside the repository and removed before the report commit.

Background Squeal results are separate from these gates. Four initial failures in shared-store, lifecycle, transitions and Codex command recovered. A later baseline message reported four failures: observed-growth's file-level `spawn git ENOENT` and preload-growth assertion, and 5,000 ms timeouts in store/open and store/repos at load 62.94. All four then recovered too. These are outside the reviewed product delta; their cause in 001-202 is unverified. The final status after writing this report was:

```text
$ node --disable-warning=ExperimentalWarning <installed-0.1.86>/dist/cli/squeal.mjs status
Revision: 1
Known failures: 0
Affected checks: 2747 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: none completed since revision 0
Daemon: running, last heartbeat 4 s ago
(exit 0)
```

The background baseline checkpoint completed at revision 0; no new checkpoint was requested for the report edit at revision 1. These are check counts, including file-level checks, rather than Vitest's test-case count. The scope checks and coordinator evidence above remain the assigned verification.

## Verdict

**PASS 38f2aadb: 0 blockers, 1 proven should-fix note, 0 nits.** Wave 13l S1's literal later-cache-hit sequence is closed on both Nodes and fails with the retention fix removed. Memory has the requested entry cap. The stronger claim that a later discharge can never erase news needed by a live wait is still false at either eviction bound. This retains the original S1's nonblocking severity: the snapshot still shows the failure, and no premature quiet over an unobserved current key is proven.

## Blockers

None.

## Should-fix

### S1. Both eviction bounds can remove membership a captured answer still needs

**Proven with default limits and the public wait on both Nodes; time is simulated for the age case.** `src/core/scheduler/discharges.ts:80` prunes without knowing whether an answer still needs an entry. At line 82, either a count above 10,000 or an age above one hour drops the oldest entry. `Scheduler.rekeyedSince` at `src/core/scheduler/scheduler.ts:334` has no alternative history after `Ledger.#discharge` at `ledger.ts:438` clears the live attribution.

D7 says that “a later move never replaces the earliest.” Wave 13l S1 asks to retain membership “needed by each outstanding captured answer.” 001-202 fixes replacement by a later record but permits eviction by that later record. Its notes already acknowledge the hour limitation; this review confirms the effect and the separate count limitation. Neither limit protects an active answer.

Reproduction, starting from the existing regression: cache warming at revisions 1 and 2, math's failing run at 3, strings' held refinement at 4, then a wait whose sync captures 4. Release math and confirm its resolved revision-3 membership while the sync is held. Retain that real file's revision-3 discharge at timestamp `t` in the default `Discharges` instance, and apply one of these inputs before releasing refinement:

| Input after math's discharge | Target retained? | Wait outcome | Own / other transitions | Edit files |
| --- | --- | --- | --- | --- |
| 9,999 distinct later entries at `t + 1`, revision 5 | yes, 10,000 total | news | 1 / 0 | 3 |
| 10,000 distinct later entries at `t + 1`, revision 5 | no, oldest evicted | quiet | 0 / 1 | 2 |
| One later entry at `t + 3,600,000`, revision 5 | yes, age exactly one hour | news | 1 / 0 | 3 |
| One later entry at `t + 3,600,001`, revision 5 | no, age exceeded | quiet | 0 / 1 | 2 |

All four observations match on both Nodes. The final snapshot still has one known failure in every case. Synthetic later entries are beyond the captured upper revision and are correctly excluded from the answer; their only relevant effect is pruning math. Controls differ by one entry or one millisecond.

The count case needs no long wait: a large cache-settled environment re-key, or repeated later cached moves, can consume the cap while an unrelated refinement is held. Each discharge can contribute two entries when its earliest and latest revisions differ. There is no worktree-size or discharge-rate bound guaranteeing fewer than 10,001 entries before an answer.

The hour is not an enforced maximum wait. `src/cli/wait-arg.ts:14` accepts any decimal millisecond value; `--wait 7200000` is valid. The wait's deadline uses `performance.now`, while pruning uses epoch time from `context.now`, normally `Date.now`. `Daemon.#requestSync` at `src/core/daemon/daemon.ts:482` waits for refinement without imposing a one-hour answer deadline, and `tryRunner` awaits runner calls without such a deadline. Thus a long pending sync, or a forward wall-clock adjustment before the next discharge, can exceed retention while the caller remains live. A naturally occurring hour-long sync was not measured; eligibility for eviction and the resulting misattribution were.

Fix sized for one attribution worker: protect membership for outstanding captured answers through their completion, with explicit release/cancellation and a bounded request budget. If a hard resource bound prevents preserving the answer, expose incomplete attribution rather than silently returning quiet with the edit's transition counted as other news. Keep discharged history separate from `keyedAt`, and preserve resolved-only files' exemption from later forced reruns. Add default-cap overflow and accepted long-wait/clock-boundary controls beside the existing sequence. Raising a constant alone does not establish the invariant.

## Nits

None.

## What fits

| Assigned question or boundary | Evidence and result |
| --- | --- |
| Is wave 13l S1 closed? | Its exact two-discharge sequence and one-discharge control pass on Node 22 and 24. The fix-removal mutation fails only the cached case on each Node. Closed for that sequence; the unconditional invariant remains limited by S1 above. |
| Can one ordinary later discharge erase the earlier entry? | The map key is `(file.id, revision)`, and `since` filters each retained entry independently. A later revision does not overwrite the earlier one. Re-noting the same pair changes its time/order but cannot exclude that revision by the captured upper bound. Only eviction reopens the assigned scenario. |
| Are memory and time bounds implemented? | The map stays at at most 10,000 entries; the unit tests cover cap, retention and removal. Age pruning happens on a new attributed `note`, not during reads. Idle history remains until then but stays count-bounded. Neither bound implies that evicted entries are unused. |
| Did 001-205 claims break attribution? | `claimOf` at `claims.ts:105` applies accepted hits through the existing `Ledger.applyResults`; a held claim itself discharges nothing. Recent edits and forced files bypass claims. The probe/lookup refactor preserves the result-acceptance gates. No change to `Discharges`, `rekeyedSince`, or the sync wire fields since 0.1.90. |
| Did 001-210 start re-probe break it? | `startable` at `tiers.ts:260` uses the same `applyResults`, which records a discharge only at the current key before clearing attribution. An all-settled start commits without a run row; it does not clear attribution by a separate shortcut. `claims-finished.test.ts` passes all three finished-tier cases on both Nodes. Existing later-cache-hit tests exercise today's implementation. No separate regression found in this delta. |
| Are prior growth and rerun exclusions preserved? | The same-revision, earlier outstanding edit, completed sibling-growth and resolved-wait regressions pass on both Nodes. History never restores `keyedAt`; resolved-only membership holds for no forced failure rerun. |
| Does transport preserve attribution? | `resolvedSince` still goes CLI to protocol/handler/front desk/daemon to scheduler in the same order. `sync.test.ts` and the CLI window/edit suites pass on both Nodes. |

## Inputs for the next wave

1. Credit 001-202's literal repair and its bounded entry count; do not rerun the settled two-discharge investigation unless the implementation changes.
2. Carry S1 as the surviving nonblocking attribution limitation. A follow-up owns `discharges.ts`, sync lifecycle/callers and focused tests, with per-request membership retained before awaiting refinement and released after the answer or cancellation. Cover overflow and long-wait/time boundaries, and preserve earliest/latest windows and resolved-only behavior.
3. Keep 001-205/001-210 settlements on `Ledger.applyResults`, with discharge before clearing attribution and state/checkpoint commit inside the existing transaction. Retain the claim, forced/recent, 004 D6 and 001-170 gates.
4. The assigned whole-tree gate is the coordinator's 0.1.94 evidence above. Build reproducibility was not checked here, as instructed. Background failures are recorded, not treated as a green suite or as new blockers without a cause in this range.
