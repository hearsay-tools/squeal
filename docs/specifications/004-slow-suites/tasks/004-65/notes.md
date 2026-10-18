# 004-65 step 2: notes

Worker, 2026-10-17, against D7 and D8 as amended and accepted by the human that day (`amendment.md`). Decisions 1 to 5 below were sent to the coordinator as defaults and confirmed; 6 (Stop) was put in this slice by the coordinator.

## Seam map

- Policy: `SlowPrecondition` in `src/core/types/policy.ts`, on `SlowPolicy.precondition` and `NodeTestProject.precondition` (both optional, additive). Loader rule `slowPrecondition` in `src/core/daemon/policy-precondition.ts`, its own file so `policy-slow.ts` and `policy-node-test.ts` do not import each other.
- Check: `src/core/slow/precondition.ts`: `preconditionFor` (a node:test project's own replaces `slow.precondition`), `checkPrecondition` (exists first, then the command), `touchesPrecondition` (re-check rule), `argvText`.
- Scheduler: `src/core/scheduler/slow-skip.ts` (`SlowSkips`), owned by `SlowTier`. `SlowTier.next()` calls `gate` after the candidates and before the load guard. `Scheduler.#pass` calls `SlowTier.revised(paths)` after `preempt()` on each applied revision.
- Activity: `SlowTierActivity` gains `{ kind: "skipped", reason, since }` (additive). `liveActivity` shows it while no slow file is pending. `skippedReason(tier)` in `src/core/state/slow-text.ts` is the one reader every surface uses: the `Slow tier:` line, `slowTierState` (delivery, told once), `slowWaitCode` and `waitLine`, `skippedLaneVerdict` (`run --all`), and both Stop entries.

## Decisions the spec left open

1. **Where it is checked:** in `SlowTier.next()`, before the load guard, so a skip never waits out `slow.maxDeferMs`. Every queued slow file whose resolved precondition has the same source leaves the queue (`ledger.dequeue`, no result stored), and `checkpoints.failed(ref)` makes its checkpoint end `abandoned`.
2. **Re-check:** skipped files are queued again by `SlowSkips.revised` at a revision: any revision for a command, one whose paths an `exists` glob selects otherwise, and any revision whose policy no longer declares the same rule. `run --slow` and `run --all` queue them as any file not current. A met check is cached for its revision and rule, so a pass of several one-at-a-time tiers runs a command once.
3. **exists:** a literal path is `existsSync` (a directory counts). A glob walks from its literal prefix, stops at the first match, and skips `.git` and `node_modules` unless the glob names them.
4. **command:** `spawn` without a shell, cwd the worktree root, stdio ignored, `lowerProcess` (nice 10) on the child, SIGKILL at `timeoutMs` (default 10000). Reasons: `<argv> exited N`, `did not exit within N ms`, `was killed by SIG`, `could not start: <error>`, each followed by `(<source>.command)`. Per project the source is `nodeTest "<name>" precondition`.
5. **run --all:** an abandoned checkpoint with a skip says `has no verdict: its slow lane was skipped, <reason>, so it is not a full suite; its fast lane at revision N: <failures or why none>`, exit 1 on the fast lane's known failures, otherwise 3 (`src/cli/run-skipped.ts`).
6. **Stop:** the waiting entry counts a skip as over at once and blocks with `slowSkippedReason` (`src/harness/shared/text.ts`). The 2 s entry and SubagentStop (`stop.ts` `decide`) use the same reason in place of `slowSuiteReason`. "Once" is the existing `stop_hook_active` rule.
7. **D5's no-artifact note:** left out for a slow file whose precondition has not been met in this daemon (`SlowSkips.unmet`), so it gives way to the skip. Once the precondition is met, the note is written as before.
8. **Line wording:** `N not run at revision R, skipped: <reason>. Squeal runs them once the precondition holds[, and Stop holds the agent once naming it]; the next revision or \`squeal run --slow\` checks it again.`

## Remaining

- `squeal setup --check` listing a command precondition (D7, vision principle 8): the coordinator's own row.
- Bundles and the version: the coordinator's, at integration. `test/harness/plugin.test.ts` and `test/harness/codex/plugin.test.ts` fail on bundle drift until then.
- KEY_FORMAT_VERSION 11 re-pinned in place twice (ed37062d, 9875c347). 011-14 re-pins the same entry, so integration must re-pin once more after both land.

## Repair 1 (review `wave-8.1.md`, 2026-10-17)

- **B1, where a skip lives:** the skips left the published activity (`SlowTierActivity` no longer has `skipped`; it was never released) for their own `meta` row, `slow-skips:<worktree>` (`src/core/state/slow-skipped.ts`, `SlowSkipRecord`: precondition, source, reason, since, test files). The activity row is replaced by any `running`/`waiting` publish, so it could not carry which files a skip holds. `classifySlowFiles` takes the skipped ids: a listed skipped file whose checks read current is `pending` when its row is queued, else `notRun`. `SlowTierState.skipped` (additive) is the reasons of the skips that still hold a file, and `skippedReason` reads only it. `slowFilesNotCurrent` now takes the store and worktree. The row outlives the daemon; the next `SlowSkips` adopts it at first use.
- **B1, how a skipped file becomes current again:** a met check lifts its source's skip (files not queued settle, taking their stored result); a revision that makes it eligible (`revised`), `run --slow` (`SlowTier.request`) and `run --all` (`SlowTier.recheck`, one line in `Scheduler.requestFullSuite`, skipped for a fast-lane request) queue the files again, and one whose key already has a stored result goes in forced, so it reaches current only by a run. Not covered: the main header's check counts still count a skipped file's stored checks as current, as `derive.ts` and `shown-result.ts` were out of this repair's ownership; only the slow-tier line, its readers and Stop are corrected.
- **B2:** `gate` reads the rule and revision under the lock, runs the check outside it, and applies the outcome under the lock only when the source and `metKey` (revision, rule) are unchanged; otherwise it returns `"again"` and `next` asks the pump to plan again.
- **B3:** `skippedLaneVerdict` names the fast lane over every listed fast file; a `fast` lane checkpoint gives `null`, a `slow` lane one names the skip alone, exit 3.
- **B4:** `revised` partitions each skip's files: eligible when the revision touches the rule or the file's resolved rule changed; the rest stay skipped.
- **S1:** the command is spawned `detached` and its group gets SIGKILL at the timeout, at close and when the leader exits, as `startGroup` in `src/runners/node-test/run/process.ts` does. `terminate.ts` has no group-kill helper; its SIGTERM-then-grace `terminate` is for scanned processes and would have been a behaviour change from the SIGKILL timeout D7 already had.
- **Red check on d58e3d05** (scratch worktree, helpers shimmed to the old activity): every new regression failed there except the B4 reverse case (override removed, global met), which the per-group code already handled; the brief asked for it beside the reviewer's case.

## Repair 2 (re-review `wave-8.1.md` "Re-review", 2026-10-17)

- **Where the skip reaches the known states:** the sink (`src/core/state/sink.ts`) reads `slow-skips:<worktree>` once per transaction and passes `skipped` to `classify` (`derive.ts`) through `stateFromResult`: a check that would be current is `stale`, or `pending` when its key row is pending. Result keys and stored results are unchanged; `shown-result.ts` needed no change, as a non-current state already names its row by outcome, fingerprint, commit and revision.
- **Ordering:** since the sink reads the row inside the ledger's commit, `SlowSkips.#skip` and `#lift` publish before `ledger.commit()`, and `#lift` `touch`es its idle files so the commit's refresh re-derives them as current. `#requeue` still publishes after its commit, on purpose: that refresh reads the files still skipped, so a file queued forced reads pending, not current, until it runs or is skipped again. This is an edit in `src/core/scheduler/slow-skip.ts`, outside the brief's listed ownership but the "checkpoint completion they need": without it the classifier change has no effect on the skip it governs.
- **Bootstrap:** a skipped file the lookup found joins the baseline's files and is marked failed at once (as an unkeyed file is), so the baseline ends abandoned. It is not queued at start: the persisted skip holds until its own re-checks (a revision that makes it eligible, `run --slow`, `run --all`), as within one daemon. Queuing it forced at start would re-check the precondition on every daemon start instead; the coordinator may prefer that.
- **Scheduler-side validity** (`src/core/scheduler/files.ts` `classify(file)`) still reads a skipped file current. Every path that should run it forces it (`recheck`, `revised`), and nothing found so far completes a full checkpoint from that reading other than the bootstrap path above.
- **Red check on 1fb4855d:** the two re-review regressions in `test/slow/precondition-history.test.ts` fail there with the reviewer's assertions (`expected 5 to be 3`, `expected true to be false`); `test/state/sink-slow-skip.test.ts` is the unit form.
- KEY_FORMAT_VERSION 11 re-pinned in place again.

## Repair 3 (third round `wave-8.1.md`, 2026-10-18, coordinator)

- `SlowSkips.#skip`, `#lift` and `#requeue` each run inside one `store.transaction`; the ledger's own commit becomes a savepoint in it. The skip row, the dequeued key rows, any checkpoint it ends and the sink's reclassification commit together.
- Regression (`test/slow/precondition-history.test.ts`, "commit together"): a second connection reads at the skip row's write, inside the writer's transaction, and sees the state before the skip; after the commit it sees the skip with three file checks current. Red on fc0b4ef8: the reader saw the skip at the write (`expected 1 to be +0`).
