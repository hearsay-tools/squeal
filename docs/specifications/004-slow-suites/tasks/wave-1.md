# 004 wave 1 briefs

Two rows in parallel on disjoint files, then 004-18. Read `docs/vision.md`, `docs/styleguide.md`, spec 004 (approved, with `status.md`'s amendments), spec 001 D5, D9 and D11, and `src/core/slow/` (004-10, 004-11) first. The scheduler is spec 004's for this wave by agreement with the 001 coordinator (its row 001-140 waits for it); its rows 001-141 (store locking) and 001-142 (escaped test children, daemon process groups) run meanwhile: stay out of `src/core/store/` and the daemon's process-group code. Do not run `npm run build`. Scratch in one `/tmp` directory of your own, removed at the end; no CPU burners; never delete or kill what you did not start; tests that start daemons stop them (`test/global-teardown.ts`). Run the full suite on Node 22 and 24.

## 004-12 the slow tier in the scheduler

Outcome: slow files never sit in a fast tier, run only when nothing fast is pending and the agent is idle or asks, one at a time per user, under the load guard, and are never stored as current against inputs that changed during their run.

Read: spec 004 D2 to D6 and D9; `src/core/scheduler/queue.ts` (recent and backlog classes, `RECENT_TIERS_PER_BACKLOG_TIER`), `tiers.ts` (`selectTier`, `executeTier`, `recordTier`), `scheduler.ts`, `ledger.ts`; the consumer turn state in the store's `meta` (001 D9, `src/core/delivery/turn.ts`); `src/core/slow/` (`slowFiles`, `acquireSlowSlot`, `waitForCapacity`).

Shape: slice. Test first. Seam: `RunQueue` gains a slow class beside recent and backlog; `selectTier` never puts a slow file in a fast tier and, when no recent or backlog file is pending at the current revision and the runner part is applied (001 D2), selects a one-file slow tier only if a trigger holds: every registered consumer of the worktree is idle or none is registered (an expired consumer counts as absent), or a slow request is open (`Scheduler.requestSlowSuite()`, new, which 004-13's `squeal run --slow` calls), or a full-suite checkpoint is requested (`run --all` includes slow files as today). Before the slow tier runs: take the slot (keep the file pending if `null`, and retry on a timer of at most 15 s while slow work is pending), then `waitForCapacity` with the tier budget left (carry the remainder from file to file within one slow pass; a new batch with fast work aborts the wait and puts the slow file back). A slow file runs at the existing runner (one file per tier; an in-flight slow file can delay a fast tier by one file until 004-18), and D4 holds through the existing stability check: a keyed input changed during the run discards and re-queues. Inheritance (D6): a predicate in a new `src/core/slow/inherit.ts`, `inheritsAcrossWorktrees(testFile, declaredInputs, allFiles, slowGlobs)`: true when the file is not slow, or its declared inputs match an existing file that is neither a test file nor under a directory a slow glob covers; every lookup of another worktree's result (start, `selectTier`'s re-lookup) skips results from other worktrees when it is false. The no-artifact note (D5): one note per project naming its slow files that have no declared artifact. Stop: a silent main-agent Stop records pending slow files like any pending file (001 D9); nothing waits for them. Notes: one when a slow file ran under load (from the guard), one when the slot was held by another worktree for longer than a minute.

Owns: `src/core/scheduler/**`, `src/core/slow/inherit.ts` and its export, `src/core/types/scheduler.ts` (additive: `requestSlowSuite`), `test/scheduler/**`, `test/slow/inherit.test.ts`, `test/integration/slow-tier.test.ts`. Leave alone: `src/cli/**` and the daemon request handling (004-13), `src/core/store/**` and process-group code (001), `src/core/keys/**`, the runners.

Done when: scheduler tests with fake runners prove goals 1 to 3 and 5 (a slow file is never in a fast tier; nothing slow runs while a consumer is in a turn or fast work is pending; a fast batch preempts between slow files and aborts a guard wait; two schedulers sharing a slot directory run slow files in turns; a keyed input changed during a slow run discards and re-queues; a slow file without a declared artifact is never inherited, with one is); one integration test with a real Vitest fixture marks a file slow and shows the edit's fast file reported before the slow file runs, and the slow file running once the consumer goes idle; lint, typecheck, full suite green on Node 22 and 24. Report every type change.

Use /worker.

## 004-13 `squeal run --slow`, and slow node:test processes observed

Outcome: the agent and the human can ask for the slow tier, and a slow node:test file that spawns the package's CLI keys what that CLI loaded.

Read: spec 004 D2 (explicit trigger), D5; `src/cli/run.ts` and how `run --all` reaches the daemon (`src/cli/daemon-access.ts`, the daemon's request handling in `src/core/daemon/`); 001-132's observed runtime inputs (`src/runners/observe/`, `status.md` lines on 001-132: spawned processes are observed for both runners).

Shape: slice. Test first. Seam: `squeal run --slow` sends a new daemon request `run-slow` that calls `Scheduler.requestSlowSuite()` (the method 004-12 adds; until it lands, the daemon handler calls it if present and answers "not supported by this daemon" otherwise), prints what it requested, and with `--wait <ms>` waits as `run --all --wait` does. Usage text and the skill's `references/commands.md`. Then a test, no new mechanism expected: a node:test fixture whose test spawns a small CLI that loads a helper, run under the daemon with 001-132's observation on: the helper enters the file's observed inputs and its edit re-runs the file. If it does not, report why instead of building a mechanism.

Owns: `src/cli/**` (the `run --slow` path and usage), the `run-slow` request in `src/core/daemon/` (the request handler only), `plugins/claude-code/skills/squeal/references/commands.md`, `test/cli/**`, `test/daemon/run-slow.test.ts`, `test/integration/slow-spawn.test.ts`, a fixture under `test/fixtures/node-test/`. Leave alone: `src/core/scheduler/**` (004-12), `src/runners/**`, `src/core/store/**`.

Done when: `run --slow` against a daemon without the method answers clearly and exits 1; with a stub scheduler exposing it, the request reaches it; the spawned-CLI test passes or the report says exactly what is not observed; lint, typecheck, full suite green.

Use /worker.

## 004-18 a separate lane for slow files (after 004-12)

Outcome: an edit's fast tests never wait behind a slow file in flight (goal 1, D2's execution paragraph).

Brief written when 004-12 lands; scope: the slow file runs in its own runner (a second Vitest instance, closed when the slow pass drains; node:test's per-file spawn as is) at `nice` 10 and `ionice -c 3` where permitted, with `slow.maxWorkers`, concurrently with fast tiers, and its result recorded through the same stability check.

## 004-12 finish (the first worker was cancelled by a parent restart)

Outcome: 004-12 done as briefed above, from the cancelled worker's commits.

Shape: finish. Your worktree starts at `f1b8b68`: three 004-12 commits (inheritance predicate, `RunQueue`'s slow class, the slow tier with triggers, slot, guard and notes). Its last uncommitted edit, autosaved as `8e76d44` on branch `coord/004-12-partial`, had just deleted `this.#wait?.abort()` in `SlowTier.preempt()` (`src/core/scheduler/slow-tier.ts:93`); read it with `git show 8e76d44`, decide what `preempt` must do (a new batch with fast work aborts the guard wait and puts the slow file back), and finish it. Then close the done-when above, item by item: a scheduler test per goal (check what `test/scheduler/slow-tier.test.ts` already proves), the missing `test/integration/slow-tier.test.ts` with a real Vitest fixture, lint, typecheck, full suite on Node 24 and 22 (re-run a failing file alone before calling it yours; load is high). Report every type change.

Contract unchanged: `Scheduler.requestSlowSuite(): Promise<SlowSuiteRequest>`, `SlowSuiteRequest = { readonly revision: RevisionNumber; readonly queued: number }`. 004-13 lands the `run-slow` handler separately with a structural cast; leave `src/core/daemon/**` and `src/cli/**` alone.

Owns and leave alone: as 004-12 above. No CPU burners; never delete or kill anything you did not start; remove your own scratch when done.

Use /worker.

## 004-14 review of wave 1

Outcome: `reviews/wave-1.md` in this spec folder, committed.

Range: `687fb0e^..7314670` on main, 0.1.45: 004-12, 004-13, 004-19 with 003-37, and the small 003-36 and 003-38. The 001 commits around it are out of scope.

Questions: (1) Goal 1 and D2: can a slow file run while fast work is pending or a consumer is in a turn, can an expired or crashed consumer keep the slow tier from ever running, and does a silent Stop record slow files pending without waiting? (2) D4 and D6: can a slow result be stored under a key whose inputs changed during its run, or be inherited from another worktree without a declared artifact, through any lookup (start, `selectTier`'s re-lookup)? (3) D2 and D3: can two daemons of one user run slow files at once, can a crash, a preempt or a close leave the slot held or the guard's budget wrong, can the guard defer past `maxDeferMs`? (4) 003-37 and 004-19, adapter version 7: can a real preload land in a test file's closure, or a test file's own load in the preloads, for every way a preload is written (`--require=x`, `-r x`, `--import=x`, quoted paths, a package specifier, project `env.NODE_OPTIONS` against inherited)? Does a slow project's spawned process record into its own file's closure when files run concurrently? (5) `run --slow` against a daemon without the method and an older daemon; 003-38's mark reaching node:test children; 003-36's primer reading the policy in every hook without failing on a bad config.

Rules as for 003-25: change no code; label findings proven, plausible or unverified; only a proven break blocks; probes under `/tmp`, removed after; never this repository's store, never `/home/agent/projects/cezar`. A probe that runs a slow file under a real daemon sets `slow.maxLoadPerCpu` high, or this host's load defers it for up to 10 minutes. No CPU burners. First review round on this slice.

Use /reviewer.
