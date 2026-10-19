# 011-21 notes (W1 of wave 4, 2026-10-19)

Slice 1: an edit's node:test or pytest tier starts beside the lane's backlog tier, with no permit, and each run's escaped-process sweep is its own (spec 011 C4 step 5 and the lanes paragraph as amended 2026-10-19; `research/streaming-lanes.md` finding 1 "The sweep breaks", finding 4 (b), Recommendation). Lead: `research/probes/streaming-lanes/prototype.patch`'s `SQUEAL_PROTO_BESIDE` path and per-run mark, without the env switch.

## The seam map

- `src/core/scheduler/tiers.ts` `busyLanes(context, ledger, inFlight)`: the lanes no tier may start in. Every lane with a tier in flight, except one whose only tier is a backlog tier (`cancel !== null`, so never a slow or an edit's tier), whose runner says `besideBacklog` for that tier's first file, and of which an edit's work is queued (`queue.hasFirstGroup` in the lane: recent or promoted, the same test `selectTier` uses for "backlog or not"). `selectTier` is unchanged: given that lane as free, it finds a first-group file among the free lanes, so the tier it selects is an edit's (`runner.tierSize`, `joinSpan`, no permit). An edit's tier may still take backlog files of comparable time after the recent ones, as any edit's tier does today.
- `src/core/scheduler/scheduler.ts`: `#inFlight` is keyed by `tier.runId`, not the lane (a lane can hold two tiers now). `#lanes()` replaces the `isSlowLane` reads over the keys (`slowPending`, `#fastIdle`, `#slowMayStart`); `#busyLanes()` feeds `selectTier` and `#freeLaneQueued`, so the pump's "the check before a tier" wakes for a beside lane too. `#cancelBacklogs` is unchanged: it still aborts a node:test backlog tier's `cancel`, which neither adapter reads (they take only `stop`); `recordTier`'s `cancelled` then only re-queues files a completed run did not complete, which a node:test run does not leave.
- `RunnerAdapter.besideBacklog?(testFile)` (additive, `src/core/types/runner.ts`). Answered `true` by `createNodeTestRunners` and `createPytestRunners` through a new `RecoveringRunnerOptions.besideBacklog` (before the adapter is built, as `tierWidth`); Vitest answers nothing, so `false`. Passed through by `composite-runner.ts` (the file's owner), `runner.ts`, `slow-instance.ts` (the fast instance) and `escaped.ts`, one line each, as `tierWidth` and `tierPart`.
- `src/core/daemon/escaped.ts` `afterEachRun`: a run whose first file's runner says `besideBacklog` marks its processes `<lane>#<runId>` (`envFor(mark)`), and `lowerWhile` and `afterRun` look for that mark. Vitest's mark stays `<lane>`: its workers take the mark at instance creation (`daemon.ts` `vitestInstance`, `envFor(lane)`), not per run, so a per-run mark would not reach them. The slow node:test lane gets per-run marks too; it runs one tier at a time, so that only narrows each sweep to what it already reached. `#markOf` reads anything after `:` as the mark, so no parser changed; `isSlowLane` still sees the `slow:` prefix in `lowerWhile`.
- `src/core/keys/key-format.ts`: `KEY_FORMAT_VERSION` 15, hash `919f359c…74a3`.

## Tests (the brief's done-when)

| # | Test | Red without the change |
|---|---|---|
| 1 | `test/scheduler/edit-beside-backlog.test.ts` "1. is current within its own run plus 1 s…": the daemon's node:test runner, the baseline's first tier is the backlog (8 files of 2 to 6 s, `backlogTierSize` 8, 4 wide, a pool of 4 permits all held), an edit of the quick file's import 300 ms in. Live (load 6.7 on 24 CPUs): current 196 ms after the edit, its own run 162 ms, 0.5 s into a backlog tier of about 10 s; every backlog file stores once | yes, with `busyLanes` forced busy: current after 9.9 s, at the backlog's end |
| 2 | same file, "2. discards and re-queues a backlog file the edit re-keyed": the edit re-keys h3 of the running tier; the edit's tier runs h3 (and the queued quick file) beside; the backlog's h3 stores nothing under the old key; the new key's result is the edit run's; h3 runs twice, not three times (the re-queue at record finds the edit's result); the other seven store | yes: the edit's run of h3 starts after the backlog tier ends |
| 3 | `test/daemon/escaped-run-mark.test.ts`: the real node:test runner behind `afterEachRun` and a real `EscapedChildren`; a 1 s run, then 300 ms later a 3 s run of the same lane; the first ends | yes, with the lane mark: "stopped 2 processes a test left running after its tier … run backlog", the second run's node processes |
| 4 | `test/scheduler/backlog-tiers.test.ts` "cancels a backlog tier for an edit, keeps its completed files and runs the edit in the next small tier", unchanged | (must stay green) |
| – | `test/daemon/beside-backlog.test.ts`: node:test and pytest say `besideBacklog`, Vitest does not, through the composite, the slow instance and the sweep | yes: no hook |

`test/version-sensitive.txt` lists the two new real-`node --test` files (its own test requires it).

How the scheduler tests get a backlog without the quick file in it: a forced `run --all` keeps a queued file forced and never upgrades it to recent when an edit re-keys it (`Ledger.settle`: `if (this.queue.isForced(ref)) continue;`). The first draft used `requestFullSuite({ force: true })` and the edit waited for the tier, beside or not. So the tests take the baseline itself as the backlog. That is a separate gap, not this slice's: during a `run --all --force`, an edit of a file still queued by it is not the edit's work and waits behind the backlog in every lane (Vitest's cancel included). `backlog-wall-latency.test.ts` (001-366's done-when 7) runs exactly that shape, so its edit still waits for the tier and its bound still holds; it is kept.

A second observation: a new failure's confirming re-run (`queueReruns`, forced, at normal D5 priority) is not first-group, so a node:test edit's new failure, found beside a backlog tier, is re-run only after that tier ends. The first result is reported at once, so the edit is not delayed; the confirmation is.

## For slice 2 (one-file slots)

- The beside rule lives in `busyLanes` only. Slots make a node:test or pytest lane hold up to W backlog tiers; `busyLanes`' "only tier is a backlog tier" then becomes "fewer than W backlog slots, or an edit's work queued and no edit's tier in flight" (the prototype's `stream-over` shape). `#inFlight` is already keyed by run id.
- The per-run mark already covers overlapping slots: every node:test and pytest run is marked by its run id.
- The bare-mark and orphan sweep (`alone`) still waits for the last overlapping run of any lane; with slots that is rarer. Not touched here.
- A process a run's leftover starts after that run's sweep carries the run's mark, and no later run's sweep looks for it; the exit sweep (`atExit`) still does. Before, a later run of the lane would have stopped it if it started after that run began. Same as the prototype; worth a look if slots make lanes busy for hours.

# Slice 2 (W3 of wave 4, 2026-10-19): one-file slots for node:test and pytest backlogs

A node:test or pytest lane runs its backlog as up to W slots: each holds one permit, starts the lane's next queued file (pytest: the next batch) as it frees, and stores its results when it ends. Vitest keeps tiers and the cancel. Spec 011 C4 step 5 and C10 as amended for slots; lead: `prototype.patch`'s `SQUEAL_PROTO=stream` path, without the env switch.

## The seam map

- `RunnerAdapter.backlogSlot?(testFile): number | null` (additive, `src/core/types/runner.ts`): the files one slot holding `testFile` runs. `createNodeTestRunners` answers 1 and `createPytestRunners` its project's `batchSize ?? DEFAULT_BATCH_SIZE` (5), both through a new `RecoveringRunnerOptions.backlogSlot` (before the adapter is built, as `besideBacklog`). Vitest answers nothing (`null`). `composite-runner.ts` (the file's owner), `slow-instance.ts` (the fast instance) and `escaped.ts` pass it through, one line each.
- `src/core/scheduler/slots.ts` (new): `backlogSlot(context, ref)`, `busyLanes` (moved from `tiers.ts`) and `joinsSlot`. In `busyLanes` a lane of slots stays free while it holds fewer than `runner.tierSize` backlog slots, no edit's work of it is queued, and it is not a slow lane (slow lanes keep one slow tier, 004 D2). The pool's grant bounds the slots further: each slot is a lease of width 1 (`take(1)`).
- `selectTier` (`tiers.ts`): the first backlog file picked sets `slot`, its runner's slot size. A pytest slot packs further files while `joinsSlot` holds, then stops at the first that does not. They must be light (last known at most `SHARE_FLOOR_MS`, 1 s, with unknown counting 0 as in `joinSpan`) and of one part. A heavy file runs alone. A slot skips the backlog wall and the grant trimming, and its size is also bounded by the backlog tier size and any `tierCap`. In a lane of slots, an edit's tier takes only the edit's work (the first group). The backlog files it passes over go to slots: `skipped` re-selects when the edit's tier took nothing. Without this, test 1 broke: an edit's permitless tier took queued backlog files whose unknown durations count 0. `startTier` sets `Tier.slot` on a cancellable tier of a lane of slots. `recordTier` gained a `commit = true` parameter.
- `scheduler.ts`:
  - `InFlight.ran`. When a slot's run ends, the slot releases its lease and frees its place in the lane (`#busyLanes` ignores flights that `ran`), so the pump starts the next file while the slot records.
  - `#ended` holds the record's reads outside the lock (warm-up read, completion barrier, install stamp). `#record(ended, commit)` is the body that runs under the lock.
  - `SlotRecords` (`slot-records.ts`, new) gathers. It waits outside the lock for `max(SLOT_GATHER_MS = 25, SLOT_GATHER_COMMITS = 3 × the last commit of slots)`, then takes every slot that ended until none is left and commits them once. `test/scheduler/slot-records.test.ts` covers it.
  - The pump fills every free slot in one lock hold.
- Why records gather: each commit's sink call lists every known state (`mergeApplied`), 55 to 340 ms on cezar's store, and the node:sqlite call holds the thread. Slots that end during a commit are not seen until it ends. Without the gather, ends stagger and commits stay near one per file: 224 of 300 at a 100 ms sink, 1.61 times one tier; 300 at 50 ms, 1.39 times.
- `KEY_FORMAT_VERSION` 16, hash `054b5d7c…7e9c`. `test/version-sensitive.txt` lists `test/scheduler/backlog-slots`.

## Tests (the brief's done-when; red on main at 89a69023 in a detached worktree)

| # | Test | Here | On main |
|---|---|---|---|
| 1 | `backlog-slots.test.ts` 1: 16 files of 1 to 5 s at W = 4 (pool of 4), forced pass after the baseline | 14204 ms against list scheduling's 13899 (2.2 %); 14564 against 14053 (3.6 %) at load 14. Widest 4, 15 progress steps | 26.0 % over, 1 progress step |
| 2 | same, 2: departure | after 4 of 12 files, each stored by its run, 8 queued, none started after the close | 0 queued: the tier held all 12 |
| 3 | `backlog-slots-overhead.test.ts`: 300 files of about 50 ms, 55 ms per sink commit, tier and slots alternating in one harness, best of 2 each | 1.09 times (19804 against 18212 ms) at load 13 to 16, 75 and 76 commits per pass. Single rounds 1.03 to 1.16 times, 75 to 148 commits. One Squeal background round at load about 19, beside other suites, took 1.33 times with 80 commits, so the test became best of two | one run of 300 and one commit per pass ("expected [ … ] to have a length of 300 but got 1") |
| 4 | `backlog-slots.test.ts` 4: another daemon's waiter, files of 2 s | its share after 2146 to 2207 ms | 8661 ms |
| 5 | `pytest-slots.test.ts`: the small fixture synced with uv, plus 12 light files of 50 ms and 2 heavy files of 1.5 s, at W = 4, backlog tier size 200 (the default) | runs of 1, 5, 5, 5, 1 files (each heavy file alone) in 2375 ms; one tier 3331 ms (0.71 times), load 15.8 | one run of 17 files |
| – | `backlog-slot-runners.test.ts`: 1 for node:test, the batch size for pytest, `null` for Vitest, through the composite, the slow instance and the sweep | green | "expected undefined to be 1" |

Done-when 5's measurement: slots 2375 ms against today's one tier 3331 ms at load 15.8. Today's tier batches the 17 files 5 by 5 in queue order, so a heavy file shares a process with four light ones and the light ones wait behind it. The first draft ran in the harness's default backlog tier size of 4, not the policy's 200. There the tier mode was 5 tiers in 5097 ms, and slots, capped at 4 files, took 2555 ms (0.50 times) at load 16.1.

Adapted under the coordinator's decision (A) ("tests follow slots, coordinator decision", aaa4ccba and 0c2e5143), each keeping its property:
- `edit-beside-backlog.test.ts` 1 to 4.
- `backlog-wall-latency.test.ts`: a node:test edit during a forced `run --all` waits at most one slot file plus its own run. Here it was current after 216 and 449 ms, against a bound of 5390.
- `test/integration/capacity-project.test.ts`: the mark is read when the third slot waits (want 3, grant 2, the root named).

Test 4 of edit-beside-backlog crashes the run holding h3 after the edit stored its PASS. With `supersededIn` reverted, test 3 fails ("expected 'queued' to be 'running'") and test 4 fails ("expected 'unknown' to be 'pass'"). The B1 stale-crash order stays exercised.

## Edges and what the next worker must know

- A slot's record waits for the gather, so checkpoint progress lags each file by the gather plus a commit. That is 25 ms on a small store and up to about 1.4 s at cezar's 340 ms commits. An edit's tier never gathers: it records at once.
- A slot's lease wants 1, so a daemon's pool mark says its demand is what it holds plus one, not the lane's W. In max-min sharing it converges as its slots are granted, one boundary at a time; a tier stated W at once. Done-when 4 holds either way.
- Packing stops at the first file that does not join, in the queue's order: a heavy file in the middle of light ones ends their batch early.
- A pytest slot of one batch runs one process, so the runner's `concurrency` (tierSize) has nothing to spread.
- Slow lanes keep one slow tier at a time; a file's `tierCap` still bounds a slot.
- Slice 1's notes still hold: per-run marks cover overlapping slots. During a forced `run --all`, an edit of a file still queued by it is not first-group work and waits for a slot.
- Expected failures in this worktree:
  - The bundle-drift tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`), because `plugins/*/dist` is the coordinator's to rebuild.
  - `run-reads-fidelity` and `observe-fidelity` under the Squeal daemon (001-390).
