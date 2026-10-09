# Wave 4.5 re-review: 003-45 (003-46)

## Verification output

Candidate: `adcd991623801b86a67b8f652d606ba187523d4c`, version 0.1.84. Scope: `fefaa9d7` (growth settle and its regression test) and `adcd9916` (version and both plugin bundles). Second and last round for 003-43. The prior findings are `reviews/wave-4.md`. 001-194 is outside this review; no result below credits its later changes.

The assigned checkout started at `9df47642`, two documentation commits after the candidate. Only `docs/board.md`, this spec's `status.md` and its brief differ. Verification ran in a separate detached `/tmp` worktree at the exact candidate, clean before and after the checks. Only this report is committed in the assigned checkout. Node 24.21.0 and 22.23.3, Linux.

```text
$ git rev-parse HEAD  # detached verification checkout
adcd991623801b86a67b8f652d606ba187523d4c

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.84 lint
> biome check .
Checked 719 files in 318ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.84 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.84 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.84 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)

$ npx vitest run --maxWorkers=4
Test Files  320 passed | 1 skipped (321)
     Tests  2335 passed | 10 skipped (2345)
Start at 22:53:07 (Europe/Warsaw)
Duration 458.14s
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node ./node_modules/vitest/vitest.mjs run \
    test/scheduler/environment-growth-wait.test.ts \
    test/scheduler/environment-growth.test.ts \
    test/scheduler/rekeyed.test.ts test/cli/status-wait.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  28 passed (28)
Duration 34.11s
(exit 0)

$ node ./node_modules/vitest/vitest.mjs run \
    test/scheduler/environment-growth-wait.test.ts \
    test/scheduler/environment-growth.test.ts --maxWorkers=1
Node 24.21.0
Test Files  2 passed (2)
     Tests  4 passed (4)
Duration 8.01s
(exit 0)
```

This is the reviewer's independent Vitest gate, as the repository requires, not a Squeal checkpoint. `npm ci` warned about the install-script allowlist entries for @parcel/watcher and esbuild. Probe code, fixture repositories, switches, stores and logs stayed under one `/tmp` directory. The full suite printed two fixture gitdir repairs and one earlier test-process sweep; none caused a failure. No repository store or `/home/agent/projects/cezar` was used. Sleeping tests determine run order; no CPU burners. Scratch and detached worktrees were removed before the report commit.

### Discriminating probe and pre-fix control

One external test uses the exact candidate's real node:test adapter, scheduler, store and state sink, plus public `waitForStatus`. It asserts the bad behavior described in B1 below. A corresponding test imports exact pre-fix `7c0461ea` sources and asserts the correct wait in the same sequence. The injected sync follows the daemon's capture-revision -> `refined()` -> `rekeyedSince(after, captured)` sequence. No socket transport is exercised. The candidate uses the adapter's ordinary lane and real per-file durations.

```text
$ node ./node_modules/vitest/vitest.mjs run --config <external>/vitest.config.mts
Node 24.21.0
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration  7.55s (tests 84%, transform 13%, import 3%)
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node \
    ./node_modules/vitest/vitest.mjs run --config <external>/vitest.config.mts
Node 22.23.3
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration  7.95s (tests 84%, transform 14%, import 3%)
(exit 0)

$ node ./node_modules/vitest/vitest.mjs run --config <external>/before.config.mts
Node 24.21.0, pre-fix 7c0461ea
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration  8.13s (tests 87%, transform 11%, import 2%)
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node \
    ./node_modules/vitest/vitest.mjs run --config <external>/before.config.mts
Node 22.23.3, pre-fix 7c0461ea
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration  8.18s (tests 86%, transform 11%, import 2%)
(exit 0)
```

An initial config import failed before running a test and was corrected. The initial public-wait assertion also ran before b's rerun, when b correctly still held the wait; it was corrected to await b's result. An intermediate probe split the runner's lanes to force b ahead of its siblings. The final probe removes that override and uses ordinary duration ordering; only its final candidate/control results support B1.

## Verdict

**FAIL adcd9916**. One proven remaining blocker in growth-window attribution. No should-fix findings. One resolved provenance nit. The original seven-step B1 reproduction is closed on Node 22 and 24: an outstanding edit keeps its revision through later unrelated growth. The converse boundary is broken by this delta: an already completed attribution is also preserved, so later growth is assigned to a completed window instead of the current one. The wait can still report quiet while the regrown files need results.

## Blockers

### B1. Growth preserves a completed historical attribution and drops that file from the window that now owes its rerun

**Proven on Node 24.21.0 and 22.23.3, with a passing pre-fix control on both.** The new partition at `src/core/scheduler/tiers.ts:380` treats every non-null `keyedAt` as an outstanding edit and settles it without a new attribution at `:383`. At this candidate, `Ledger.applyResults` (`src/core/scheduler/ledger.ts:236`) does not clear `keyedAt`. A completed edit, or even the first baseline growth at revision 0, therefore leaves a non-null historical value.

This is a regression in the changed boundary, not a request to review pre-existing ledger behavior in general. Before `fefaa9d7`, growth assigned the latest revision and handled these completed files correctly. Preserving an outstanding earlier revision repairs the prior reproduction, but preserving a completed one assigns new work to a window the file has already discharged.

The brief asks whether “no growth move [...] attribute[s] a file to a window it does not owe.” The growth contract in `tiers.ts:375` also puts a file with no outstanding edit into the latest revision's window. Spec 001's wait contract, quoted by `src/cli/status-wait-edit.ts:15`, holds for a window's rekeyed files until they have results under their new keys; completed windows no longer own later work. `Scheduler.rekeyedSince` at `scheduler.ts:307` reports the retained historical revision. `unseenRevisions` at `status-wait-edit.ts:115` sees that the prior result already discharged it and excludes the still-pending file.

Reproduction:

1. Create a project with three passing node:test files a, b and c. Its `--require ./scripts/setup.cjs` reads a switch in the probe's external directory and computes `require("../src/p" + n + ".cjs")`. Both tracked helpers p0 and p1 already exist. Keep the switch at 0 through baseline and its complete-key reruns. All files have current results; baseline growth left each `keyedAt = 0`.
2. Edit a with a comment, creating revision 1. Let its run complete. Its current result is observed at revision 1, but `keyedAt` remains 1.
3. Change the external switch to 1 and edit b with a comment, creating revision 2. The switch is a controlled stimulus for a second observed preload path, not a claimed keyed filesystem input. Hold b's completed report before the scheduler records it. Its run observed p1, which its selected environment key lacked.
4. Release b's report. Environment growth correctly rekeys all three files and withholds b's incomplete-key result. The new settle keeps a/b/c attributed to revisions **1/2/0**, respectively, although a and c had already discharged those earlier windows.
5. Let b's complete-key rerun finish. Hold a and c's reruns before the adapter executes them. b is current; a and c's actual store rows remain running/queued. They are slower than b by sleeping 700 ms in their tests, so ordinary last-duration ordering selects b first; there is no lane override in the final probe.
6. Call public `waitForStatus`. Its sync captures revision 2 and names the retained revisions. There is no registered consumer, so the start revision is the heard revision. a's old observed revision 1 and c's old observed revision 0 make their historical attributions look discharged. The wait returns **quiet, zero edit files, zero edit pending**, before either regrown sibling completes.
7. Release the held siblings only after recording the result, then drain and close the scheduler.

```text
                                     adcd9916             pre-fix 7c0461ea
workspace / captured revision        2 / 2                2 / 2
attribution a / b / c                 1 / 2 / 0            2 / 2 / 2
actual a / b / c pending              held / none / held   held / none / held
wait outcome                         quiet                timeout
wait edit files / pending            0 / 0                3 / 2
Node 24 wait duration                 57 ms                1002 ms
Node 22 wait duration                 57 ms                1002 ms
```

The one-second control wait intentionally times out because the probe still holds a and c; it proves membership and pending counts, not a production timeout requirement. The overall status header correctly reports the siblings pending in both versions. The dishonest part is the edit wait's quiet completion and attribution, not result publication. The incomplete-environment guard continues withholding b's first result.

Fix sized for one coordinated scheduler worker: distinguish an **outstanding** earlier rekey from a completed historical attribution. Preserve the former through growth; give the latter the latest revision when growth moves its key. Clearing settled attribution after a result or terminal unknown, as 001-194's brief proposes, is one route, but its later implementation and integration are outside this verdict. Retain the original captured-revision-1/later-unrelated-revision-2 test and add this completed-sibling case; the repair must satisfy both. Do not fix this by putting every growth back at the latest revision, which would reopen the original B1.

## Should-fix

None.

## Nits

### N1. The assigned checkout was ahead of the named candidate

**Proven, resolved for this review.** `HEAD` initially was `9df47642`; executable files match `adcd9916`. Exact-candidate verification in the detached checkout resolves the provenance mismatch. No product change is needed.

## What fits

| Question | Evidence and result |
| --- | --- |
| Original B1 | The new public-wait regression and its no-environment-report control pass on both Nodes. A pending revision-1 file survives later unrelated revision 2 and growth, stays held through its rerun, then ends with one edit file and no edit pending. |
| First attribution | `environment-growth.test.ts` passes on both Nodes, including repeated growth's latest-window assertion for a file with no earlier edit. The partition gives a null attribution the current revision. It does not distinguish completed non-null values; that is B1. |
| Exclusions | The existing `rekeyed.test.ts` and `status-wait.test.ts` controls pass on Node 22. Files from unrelated windows and ordinary backlog retain their exclusions. B1 is caused by newly misattributed growth, not a general request to wait for backlog. |
| Environment publication and discard bound | The delta changes only how growth's key moves are attributed during settle. It leaves environment comparison, incomplete-key withholding, the three-discard bound, result writes and recovery intact. The growth and forced-other-worktree tests pass on both Nodes; the prior review's already-settled routes are not re-prosecuted. |
| Transaction and interfaces | Both disjoint partitions settle inside the existing recording transaction. Missing ledger entries are ignored by `settle`. No public type, runner interface, store schema or runtime dependency changes. |
| Bundles | Both shipped CLI bundles contain the partition, and the exact-candidate build produces no tracked drift. Version 0.1.84 is consistent across package and plugin metadata. |

## Inputs for the next wave

1. This is the second and last review round. Take the remaining growth-window blocker to the human; do not automatically dispatch a third 003 review.
2. Coordinate the disposition with the 001 lane. This candidate must not be credited with 001-194's later clearing of completed attribution. If that work supplies the remedy, evidence must cover the integrated candidate and both outstanding and completed-window cases.
3. Keep environment reread -> observed preparation -> transactional recording, with incomplete-key results withheld before shared writes. No new change to observation or package keys is needed for B1.
4. Preserve the original B1/control and the completed-sibling sequence on Node 22 and 24. A green single-file pending-growth test alone cannot settle the completed-attribution boundary.
