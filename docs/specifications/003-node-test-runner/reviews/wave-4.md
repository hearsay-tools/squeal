# Wave 4 review: 003-43 (003-44)

## Verification output

Candidate: `70a99c824b52221252d696cd816c30da58e5dafe`, version 0.1.82. Range: `4bc0d444^..70a99c82`. First round on this slice. Scope is 003-43, its agreed `keyedAt` change and bundles; 001-187's `environmentFiles` and 001-186's wait interface are checked only where this repair relies on them. Other 001 work is outside this review.

The assigned worker checkout started at `90758053`, two documentation commits after the candidate. Its executable files match the candidate. Verification ran in a separate, detached `/tmp` worktree at the exact candidate, clean before and after the checks. Node 24.21.0, Linux. The report alone is committed in the assigned checkout.

```text
$ git rev-parse HEAD  # detached verification checkout
70a99c824b52221252d696cd816c30da58e5dafe

$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.82 lint
> biome check .
Checked 717 files in 178ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.82 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.82 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.82 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git status --short
(no output, before and after tests)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)

$ npx vitest run --maxWorkers=4
Test Files  318 passed | 1 skipped (319)
     Tests  2328 passed | 10 skipped (2338)
Start at 22:19:36 (Europe/Warsaw)
Duration 471.36s
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node ./node_modules/vitest/vitest.mjs run \
    test/scheduler/environment-growth.test.ts \
    test/scheduler/observed-growth.test.ts \
    test/scheduler/preload-heal.test.ts \
    test/runners/node-test/adapter-preload.test.ts \
    test/integration/node-test.test.ts --maxWorkers=1
Test Files  5 passed (5)
     Tests  11 passed (11)
Duration 32.82s
(exit 0)
```

`npm ci` warned about the install-script allowlist entries for @parcel/watcher and esbuild. The full suite printed two fixture gitdir repairs and an earlier test-run process sweep; neither caused a failure. This is the reviewer's independent Vitest gate, as the repository requires, not a Squeal checkpoint. No full gate was repeated.

### Discriminating probes

Eight external tests imported the exact candidate sources. All probe code, fixture repositories, counters, stores and logs were under `/tmp`; no repository store or `/home/agent/projects/cezar` was used. The live timeout used a sleeping process, not a CPU burner. The process-death case killed only the probe's own node:test parent. Probes and the verification worktree were removed before the report commit.

```text
$ ./node_modules/.bin/vitest run --config <external>/vitest.config.mts
Node 24.21.0
Test Files  1 passed (1)
     Tests  8 passed (8)
Duration 15.74s
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node \
    ./node_modules/vitest/vitest.mjs run --config <external>/vitest.config.mts
Node 22.23.3
Test Files  1 passed (1)
     Tests  8 passed (8)
Duration 13.93s
(exit 0)
```

Two tests assert B1's bad behavior and its control. The other six cover partial timeout, partial process death, the three-discard bound with recovery by request and by an environment-input edit, an older refinement environment snapshot applying after growth, and an environment-allowlist policy reload during a held first result.

Initial probe assertions confused an unknown file with a check whose outcome literally equals `unknown`, and treated `process.exit(7)` as an incomplete reporter stream. Those assertions and the death stimulus were corrected before these successful runs. The rotating-preload fixture also needed six helpers: Node runs the preload in both its parent and test child, so three helpers did not produce three growing runs. Those setup attempts support no finding.

## Verdict

**FAIL 70a99c82**. One proven blocker, B1. No should-fix findings. One resolved provenance nit. The incomplete-environment publication repair holds in the exercised store, inheritance, forced-request, partial-run and policy/refinement routes. Its new wait attribution can erase an earlier edit's outstanding file from a wait that already captured that edit's revision.

## Blockers

### B1. Growth at a later unrelated revision removes the earlier edit's pending file from `status --wait`

**Proven on Node 24.21.0 and 22.23.3.** `src/core/scheduler/tiers.ts:379` assigns the growth moves to `ledger.revision.number`. `Ledger.settle` overwrites the file's sole `keyedAt` at `src/core/scheduler/ledger.ts:157`. The consumer, `Scheduler.rekeyedSince` at `src/core/scheduler/scheduler.ts:311`, excludes a file whose latest attribution is above the requested window. The daemon captures the window's upper revision before awaiting refinement (`src/core/daemon/daemon.ts:466` to `:469`).

The 003-43 landing amendment requires that “`status --wait` holds for the regrown files.” The new comment at `tiers.ts:374` claims these moves stay “inside every window that holds the run's edit.” Spec 001's wait contract, reflected in `src/cli/status-wait-edit.ts:15`, holds for an earlier edit's files until they have a result under their new keys, while excluding edits made after the wait started. An unrelated later edit must not erase a file the earlier edit still owes.

The probe uses a real node:test adapter, scheduler, store and state sink, plus the public `waitForStatus`. Its injected sync performs the daemon's exact sequence of capturing the revision, awaiting `scheduler.refined()`, and calling `rekeyedSince(0, captured)`. It does not fabricate file membership. No socket transport is exercised.

Reproduction:

1. A tracked node:test project has `--require ./scripts/setup.cjs`, which loads `nt/src/hidden.cjs` through `require("../src/hidden" + ".cjs")`. Its single test passes. Start the baseline and hold its first completed adapter report before the scheduler records it. The selected key lacks the computed preload path.
2. Edit `nt/test/a.test.mjs`, adding a comment. This creates revision 1 and moves its key with `keyedAt = 1`. Hold that revision's refinement after its closure answer is computed.
3. Start the wait while revision 1 is current and its test has no current result. Its sync captures revision 1 and waits for refinement.
4. Edit the tracked, unrelated `src/strings.ts`, creating revision 2. No node:test closure depends on this file.
5. Release the first report. The new environment guard reads the preload environment and moves the test's key again. Its environment-growth settle assigns `keyedAt = 2`. Its first result is correctly withheld; the file still needs its rerun.
6. Release the refinement and hold the next adapter run before it executes. The sync returns `{ revision: 1, rekeyed: [] }`, because `rekeyedSince(0, 1)` sees only the replacement `keyedAt = 2`.
7. The wait reports **quiet, zero files, zero pending**, before that rerun completes. The actual test-file key row is still pending. Release the rerun only after recording the wait result.

Captured results:

```text
                             growth report       control without environmentObserved
sync captured revision       1                   1
latest workspace revision    2                   2
sync rekeyed files            []                  [a.test.mjs at revision 1]
wait outcome                 quiet               timeout
wait files / pending         0 / 0               1 / 1
Node 24 wait duration         77 ms               5005 ms
Node 22 wait duration         73 ms               5002 ms
actual file after wait        pending/running     pending/running
```

The control changes only the held report's `environmentObserved` field; the adapter still ran, the same edits and gates occurred, and the same rerun stayed held. It isolates the new environment-growth attribution from the pre-existing wait path. The in-range test at `test/scheduler/environment-growth.test.ts:117` checks `rekeyedSince(revision - 1, revision)` at the latest revision, so it cannot catch a captured earlier upper bound.

Fix scope: one scheduler/wait worker, with the 001 lane's agreement. Preserve an outstanding file's membership in earlier edit windows when a later growth move also re-keys it. A single overwritten latest revision cannot answer which earlier pending windows still own the file. Retain the necessary bounded pending attribution or capture equivalent membership at the sync boundary. Merely assigning the tier's older revision instead would reopen the agreed requirement not to erase a later edit's attribution; do not replace one lost window with another.

Add this deterministic revision-1 wait / unrelated revision-2 / held-growth case through `waitForStatus`, with the no-growth control. Until a sound result or relevant transition exists, the captured revision-1 wait must retain the file and remain pending. Keep the no-later-edit growth test and the existing exclusions for unrelated backlog and later edits. The environment result-withholding guard itself does not need to be relaxed.

## Should-fix

None.

## Nits

### N1. The assigned checkout was ahead of the named candidate

**Proven, resolved for this review.** Initial `HEAD` was `90758053`, not `70a99c82`. The only intervening changes were `docs/board.md`, spec 003's `status.md` and its review brief. Exact-candidate verification in the detached temporary worktree resolves the evidence mismatch. No product fix or new gate is needed.

## What fits

| Question | Evidence and result |
| --- | --- |
| Incomplete-key publication, inheritance and refresh | `Observed.record` reports each run's observed-only preload paths even when already known locally. The composite retains them. `rekeyEnvironments` compares them with the tier's selected stability inputs, not merely the current environment. `recordTier` withholds the affected file before `storeResults`. The gated two-worktree and held forced-request tests pass on both Nodes; incomplete selected keys have no stored rows. 001 wave-13j B2's refresh route is closed in these cases. |
| Timed-out and dead files | Live partial-run probes preserve the completed sibling's environment observations through the composite. The completed file runs again under its complete key; both original incomplete keys have no results. The sleeping or killed sibling is marked unknown. A partial process death intentionally leaves the aggregate end `completed` while naming the unfinished file; the test checks per-file completion. A wholly crashed report or thrown adapter has no completed file, so `recordTier` cannot store its results. |
| Cancellation and policy reload | The held-report edit probe also exercises a completed file in a cancelled backlog tier: unstable inputs withhold its result before any store write. The allowlist-reload probe withholds the original incomplete key and passes after one rerun. Source inspection finds no cancellation-specific bypass of the new environment check. This does not claim to repair the pre-existing node:test cancellation implementation. |
| Discard bound and recovery | A preload loads new paths on three successive runs, then settles. Exactly three runs occur before unknown, with reason `3 runs in a row loaded environment files their key lacked (nt/src/p4.cjs, nt/src/p5.cjs)`. A second project passes without starvation. An observed-only refresh does not restart the exhausted file. An ordinary `run --all`, or a content edit of the now-keyed preload input, permits its fourth run and reaches pass. Unknown persists without either trigger; that matches the existing D12 unknown-until-key-change/request rule, rather than automatically retrying forever. |
| Lock and refinement seam | The key reread, observed preparation and recording run under one scheduler mutex. Another local revision cannot interleave between `setEnvironments` and `ledger.settle`. If a refinement already applied the environment, the old tier still has its selected inputs and is withheld, even with no new environment changes. The external held-snapshot test applies an older refinement environment answer after growth; a subsequent run repairs the transient reversion, stores no result at the initial incomplete key and reaches pass within three runs. No permanent lost reread or unbounded loop was reproduced. B1 concerns wait attribution, not unsafe result storage. |
| Normal wait attribution | At the latest revision, the in-range growth test proves the file is returned by `rekeyedSince`. The failure is the earlier captured upper bound after an unrelated later revision, as B1 shows. |
| Test edits | `preload-heal.test.ts` now requires A to run more than once and have a different key from B, while retaining B's own failure and excluding a false flaky note. `node-test.test.ts` requires exactly project c's file after its helper edit, and still checks project d's separate preload edit. Their expectations fit the immediate growth rekey; all five changed test files pass on Node 22 and in the Node 24 full gate. The shared helper retains the gated ordering, separate bytes, own/inherited checks and fixture cleanup. |
| Build and interfaces | Both committed plugin bundles match the exact-candidate build. The public addition is optional `RunReport.environmentObserved` with `EnvironmentObserved { project, paths }`. No new runtime dependency or store-schema migration. The release's Squeal version participates in the environment hash, so omitting an adapter-version raise does not reuse pre-fix release keys. |

These conclusions are bounded to the stated routes and accepted observation limits in D3/D5. They do not claim to observe custom loader-thread inputs or children that replace their environment.

## Inputs for the next wave

1. Dispatch B1 as a coordinated scheduler/wait repair. Agree on outstanding revision membership with the 001 lane before changing the internal attribution interface.
2. Keep the order `rekeyEnvironments` -> `prepareObserved` -> transactional `recordTier`; compare run evidence with selected inputs, and withhold incomplete-environment results before every shared write and refresh.
3. Keep `MAX_DISCARDS = 3`, the named-path unknown reason, and recovery through an input-key change or explicit checkpoint. Preserve the second-project and stable-environment controls.
4. Carry the captured-earlier-window probe into the repair tests on both Nodes. A latest-revision `rekeyedSince` assertion alone is insufficient. Repairing this does not require reopening the passing two-worktree false-heal or helper-attribution slices.
5. The independent gate is green. B1 still blocks the wait guarantee; it is not a timing-test failure or an unverified race. The coordinator decides the next row and release disposition.
