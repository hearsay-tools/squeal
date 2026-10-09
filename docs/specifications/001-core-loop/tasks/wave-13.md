# Wave 13 briefs

From `specifications/003-node-test-runner/lessons.md` defects 2, 5 and 8 (003-19's cezarion dogfooding), 001-137's finding and the 0.1.41 gate. Standing models per the board. Rows run in parallel; 001-140 waits for spec 004 wave 1, which owns `src/core/scheduler/` until it lands.

Shared rules: never touch this repository's store or daemons you did not start; stop every daemon you start; do not run `npm run build` or touch any `dist`; commit as you go; one `status.md` line per row. The host is shared and loaded: run Vitest with `--maxWorkers=4` at most, and re-run a timing failure on its own before calling it yours. Do not edit `src/core/scheduler/` (spec 004's until its wave 1 lands); if the fix needs it, stop and ask.

## 001-141 a second daemon on the shared store never costs the first a tier

Use /worker. Shape: slice.

Outcome: a daemon starting, or doing its startup work, on a store another worktree's daemon is using never makes the running daemon's tier fail with `database is locked`; every run row it opens is closed.

Read: 003 `lessons.md` defect 5 (at 09:13:07 worktree 1 noted "scheduler stopped running tiers: Error: database is locked"; the tier begun at 09:12:12 never closed its run row and its four files ran again); spec D6 (store), D12 (failures); `src/core/store/connection.ts`, `src/core/store/open.ts`, the store's write paths, `src/core/scheduler/scheduler.ts:329` (read only).

Questions to settle first, with a test that reproduces the lock: which statement waited past the busy timeout, which connection held the write lock (a migration, a long transaction at startup, a checkpoint), and whether the fix is a busy timeout, shorter transactions, or a retry. Prefer fixing the holder over retrying the waiter.

Own: `src/core/store/`, `src/core/daemon/` startup (not the runner construction in `daemon.ts`, which the 002/003 coordinator owns), tests under `test/store/` and `test/daemon/`, D6 or D12 in `spec.md` if a rule changes.

Done when: a test starts a second daemon on one store while the first runs a tier, repeatedly; the first loses no tier and logs no lock error; its run rows close; the cause is named in the summary.

## 001-142 test children that escape a run never outlive the daemon

Use /worker. Shape: slice.

Outcome: a process a test starts and leaves behind (reparented, still in the daemon's process group or its own) is killed when its tier ends, and none survives `squeal stop` or the daemon's exit.

Read: 003 `lessons.md` defect 8 (two cezar `fake-dev-server.mjs --delay 600000` from a Vitest tier survived 57 min in the daemon's process group and `squeal stop`); spec D12 (deadlines kill process groups); 001-138's `test/daemon/strays.ts` (how the suite finds and kills strays); how the Vitest runner and the node:test runner start test processes (`src/runners/vitest/`, `src/runners/node-test/run/process.ts`, read only unless agreed).

Decide and record in D12: how a tier's escaped descendants are found (process group, a per-tier marker in the env, the cgroup), when they are killed (tier end, stop, exit), and that the daemon itself and its next tier are never hit. Ask before editing `src/runners/node-test/` (the 002/003 coordinator's).

Own: `src/core/daemon/` (lifecycle, stop, exit), `src/runners/vitest/` process handling, `src/core/types/` (additive), tests under `test/daemon/` and `test/runners/vitest/`, D12 in `spec.md`.

Done when: a test whose file spawns a detached long sleeper, under a real daemon, finds it gone after the tier ends; a second case finds it gone after `squeal stop`; a test's own short-lived children are unaffected while it runs.

## 001-143 research: where the recorder's time goes in a spawned node CLI

Use /researcher. Output: a dated section in `tasks/001-132/notes.md` and probes under `tasks/001-143/`.

Question: 001-137 measured cezar's `artifacts/cli` and `discovery/cli` at a median 17.1 s and 26.2 s with the recorder against 9.3 s and 16.3 s without it, while the process tree's CPU rose only 3% and the `--help` child alone cost 1.5 CPU-seconds either way. Where is the wall time spent? Candidates from reading `src/runners/observe/`: the synchronous `appendFileSync` flush before each IPC message, one `realpathSync` per new path, the `module.registerHooks` resolve hook in every node child, `tsx`'s loader under the hook.

Method: a fresh cezar clone (every cezar command with each `CEZ_*` variable unset and its cwd in the clone, never your session's shell), the two files with and without the recorder, first on an idle-ish host then under 001-137's bounded load (`tasks/001-137/arm.sh`, at most 8 burners, each under `timeout`, alive only during a measured run; confirm with `pgrep -f squeal137-burn` that none remain). Time each candidate by disabling it alone in a copy of the recorder. Report wall time, not only CPU.

Done when: the candidate (or combination) accounting for most of the difference is shown by experiment, with a recommended change and its expected effect; everything else is tagged "not determined, because".

## 001-145 the released-bundles handover test never misses its successor

Use /worker. Shape: fix.

Outcome: `test/daemon/handover.test.ts` "a 0.1.32 daemon, a current hook, then a released 0.1.31 hook: a current daemon serves" passes reliably at the host's usual load.

Read: the board row's evidence (fails about half its runs at load 60 to 75 with "the successor serving not met in 30000 ms", on `e202b50` and `ee9d137`); `test/daemon/handover.test.ts`, `test/daemon/step-down-helpers.ts`; spec D10 (step-down, `--await-lock`); `src/core/daemon/` step-down and successor start.

Name the cause first: does the successor start late, start and exit, or never start (log the successor's spawn and its notes)? If the product misses a successor, fix the product; if the test's deadline is wrong for its load, say why the new one is right.

Own: `test/daemon/`, `src/core/daemon/` step-down and successor paths, D10 if a rule changes.

Done when: the cause is named with evidence, and the case passes ten runs in a row (`-t` on that case) at load 60 or more.

## 001-146 a run never executes a module older than the bytes its key names

Use /worker. Shape: fix, reproduce first.

Outcome: whatever sequence of edits lands on disk, a stored result was produced by the bytes its key names, or it is not stored as current.

Evidence (read only, never modify): `/home/agent/projects/squeal/.ai/cezar/tmp/4c670899-aa9d-41d9-a611-4c2996e1cf44/evidence-001-146/`: run `acd5f2eb`'s `report.json` and `vitest.log`, the branch reflog, and `squeal why` for one check. In the 002/003/004 coordinator's worktree under a 0.1.42 daemon, a rebase at 23:30:51 put the old `src/cli/run.ts` back and seven cherry-picks restored the new one within the same second. At 23:35:56 run `acd5f2eb` (revision 239, commit `b984524` dirty, 549 ms, key `a84a304f3638`) stored 7 FAILs of `test/cli/run-slow.test.ts` as current, all `squeal run: unknown argument "--slow"` (the old module). A plain `npx vitest run` on the same tree passes 7/7.

Read: spec D2 (watcher, revisions), D4 (keys and closures), D5 (scheduling and the long-lived Vitest instance); `src/core/watcher/`, `src/runners/vitest/` (how changed files invalidate the instance's module graph), how a tier hashes the bytes it keys by versus the bytes Vitest loads.

Questions to settle with a failing test first: does the watcher coalesce a revert-and-restore into no change for that file, or report it while the Vitest instance keeps the module it loaded during the brief revert? Is the key computed from bytes read at a different moment than Vitest's load? Then fix the cause; if a gap cannot be closed, the result must not be stored as current (unknown with a reason).

Own: `src/core/watcher/`, `src/runners/vitest/`, `src/core/keys/` if keys are involved, tests under `test/watcher/`, `test/runners/vitest/`, `test/integration/`; D2, D4 or D5 if a rule changes. Not `src/core/scheduler/` (spec 004's until its wave 1 lands): if the fix needs it, stop and ask.

Done when: a test performs a sub-second revert-and-restore of an imported module under a real daemon and the stored result matches a fresh run; it fails without the fix; the cause is named with evidence.

## 001-147 the recorder flushes before a message only where a stop can follow it

Use /worker. Shape: fix.

Outcome: a process that posts many messages from its main thread (tsx's esbuild calls in a cold-cache child) pays no disk write per message; nothing a Vitest worker or thread records is lost.

Read: 001-143's findings (`tasks/001-132/notes.md`, its dated section; `tasks/001-143/results.txt`): the recorder's `appendFileSync` before every `MessagePort.prototype.postMessage` cost a median 5.9 s per cezar `--help` child; flushing before `postMessage` only inside a worker thread brought 0 of 18 timeouts against 8 of 18 (p 0.003). The flush exists because Vitest stops a fork after its `process.send` and a thread at its `postMessage` (`src/runners/observe/recorder.cjs` header).

Change: keep the flush before `process.send` and at exit; flush before `postMessage` only when `!isMainThread`. Measure whether a worker thread that posts many messages still pays one write each, and if it does, bound it (for example, flush only when something is pending and at most once per event-loop turn) without losing the at-message guarantee the "twenty Workers terminated at their message" test proves.

Own: `src/runners/observe/`, `test/runners/observe/`, D4 in `spec.md` if the rule's wording changes. Do not run `npm run build`.

Done when: a test with a main-thread loop of many `postMessage` calls shows no per-message write (count the appends); the existing recorder tests pass under both pools; 001-143's probe (`tasks/001-143/rounds.sh`, the two cezar files, no burners) shows the recorder within noise of no recorder, with the command and numbers in the report.

## 001-140 a revision's work never waits behind an older revision's unrelated tier

Use /worker. Shape: slice. After spec 004 wave 1 (on main from 0.1.45, `7314670`).

Outcome: when a newer revision's affected files (any runner) are disjoint from a tier still running for an older revision, the newer revision's runner part (affected sets, closures) completes and its files start without waiting for that tier, within the daemon's concurrency limits.

Read: 003 `lessons.md` defect 2 (at r4 the edit touched only `test:package` node:test files; their run started 4 min 17 s later, behind a 425 s tier of r2's Vitest re-runs, and until then even the runner part stayed pending); spec 001 D5 (scheduling, tiers, superseding) with 003 D7 (node:test beside Vitest); spec 004 (the slow tier, `slow-tier.ts`, the slow class in `queue.ts`, `tiers.ts`, `ledger.ts`, `scheduler.ts`) so the change keeps its rules; `src/core/scheduler/`.

Questions to settle first, with a failing test: what serializes the runner part behind a running tier (one scheduler loop, the mutex, the ledger), and what serializes tiers across runners (one tier at a time daemon-wide, or per runner)? Decide, and record in D5: may a second tier run concurrently with one in flight when their files and runners are disjoint, and with what cap on total workers; or does the old tier yield (cancel or supersede) to newer work. Prefer the smaller change that removes the wait for the runner part and for disjoint files; ask before changing a rule spec 004 set.

Own: `src/core/scheduler/`, `src/core/types/scheduler.ts` (additive), tests under `test/scheduler/`, D5 in `spec.md`. A test that runs a slow file under a real daemon must set `slow.maxLoadPerCpu` high, or the load guard defers it for up to 10 min. Do not run `npm run build`.

Done when: a scheduler test holds an older revision's Vitest tier running (a slow file) while a newer revision changes only an unrelated file of another runner (or another project), and the newer file starts and its result is stored before the older tier ends; the runner part of the newer revision is never pending behind it; existing scheduler and spec 004 tests pass.

## 001-149 review of wave 13

Use /reviewer on gpt-6.1-sol. Output `reviews/wave-13.md`. Range: from `75c2fbf` (the wave 13 briefs) to the 001-140 landing, against spec 001 (D2, D4, D5, D6, D8, D10, D11, D12 as amended) and spec 004's rules where 001-140 meets them. Rows: 001-141 (0.1.44, short prune transactions; `open` takes no write lock), 001-142 (0.1.43, the daemon stops what tests leave running), 001-144 (0.1.41, a recorder leaves another Squeal's children alone), 001-145 (handover test waits for the successor at the lock), 001-146 (0.1.47, no stale transforms after a sub-second revert-and-restore), 001-147 (0.1.46, flush before a message only where a stop can follow), 001-140 (0.1.49, lanes). The 002/003/004 coordinator's 0.1.45 and 0.1.48 are in the range but not under review; read them only where they meet these rows.

Questions, with probes, not only reading:
- **Correctness first (vision principle 2):** can any of these rows let a stale result present as current? 001-146: other ways for Vite's bytes and the key's bytes to differ (a file changed during a closure walk, a rename, a file read through a symlink, a node:test file). 001-140: two lanes in flight across a revision, a superseded tier, a crash in one lane, `Tier.changes` and `Tier.run` per tier, the runner part applied while a tier runs.
- **Never killing the wrong process (001-142):** in the 0.1.49 gate, `test/runners/vitest/child-env.test.ts` once had `afterTier(since)` stop 2 marked sleepers where 1 was expected (pids 2635312 and 2635569; it passes alone 3 of 3): was the extra one started before `since` (the start-time comparison's granularity under load) or the other pool's? Also pid reuse, the daemon's own children, a pipeline sharing its group (fixed in `bd410dd`), two overlapping runs (001-140's `afterEachRun`), `squeal stop` under load.
- **Store (001-141):** does the batched prune ever delete a result that became live between batches, and does `auto_vacuum` still reach a new store.
- **Recorder (001-144, 001-147):** can a path a Vitest fork or thread read before its last message be lost; does a nested Squeal's subtree stay with that Squeal only.
- **Tests:** do 001-145's and 001-146's test changes still test what their names say, or do they now pass by waiting out the behaviour?

Known noise: Squeal sessions started before 0.1.41 report false observe-test FAILs (the nested-recorder bug); timing tests under `test/harness`, `test/e2e/worktrees.test.ts` and `test/watcher` fail under load 60+ and pass alone. Never touch this repository's store or daemons you did not start; stop every daemon you start; `--maxWorkers=4` at most.

## 001-150 the Vitest adapter's runner part never queues behind its own run

Use /worker. Shape: slice. After 001-149 and 004-18 (on main from 0.1.51, `6418a6b`).

Outcome: while a Vitest tier runs, a newer revision's runner part (invalidate without a recreate, `affected`, `closure`, `environment`, enumeration) completes without waiting for that run; so a node:test-only revision's tier starts and stores its result beside the running Vitest tier, with the real adapter (003 lessons defect 2, cezar r4).

Read: `tasks/001-140/notes.md` (the remaining slice (c): `VitestAdapter.#serial`, the `config.related` window, what `run()` and a recreate must exclude); `reviews/wave-13.md` "Inputs for the next wave" item 3 (the existing lane test bypasses the adapter's gate with `runnerPartBesideRun`; add a real held-worker test; protect recreates and `config.related`; keep 001-146/001-151's stamps effective); 004-18's slow Vitest instance (built through `createRecoveringRunner` → `createVitestAdapter` → `#start`, its own `#serial`); D5, D11 as amended.

Decide and record in D5 or D11: which calls may overlap a run, which must still exclude it (a recreate; anything writing `config.related` or the project list), and how a call that would need a recreate during a run waits.

Own: `src/runners/vitest/` (`adapter.ts`, `sources.ts` only as needed), `src/core/daemon/composite-runner.ts` only if the fan-out must change (ask first, it is the 002/003 coordinator's), tests under `test/runners/vitest/` and `test/scheduler/`, D5/D11 in `spec.md`. Do not run `npm run build`.

Done when: a test with the real Vitest adapter holds a Vitest worker mid-run while a newer revision changes only a node:test module (or a file of another Vitest-less lane), and that revision's runner part lands and its tier's result is stored before the held Vitest run ends; a recreate during a run still waits for it; 001-146/001-151's stamp tests pass.

## 001-148 a path first observed through a directory link re-runs its file at most once

Use /worker. Shape: fix. After 004-18 (0.1.51).

Read: the board row's evidence; `test/scheduler/first-observation.test.ts:146` ("read through a directory link": 3 runs where at most 2 are allowed; fails about half its runs alone at load 36 to 63, on 0.1.42 and 0.1.45 alike); 001-134's first-observation rule in D4 and `src/core/scheduler/observed.ts`; 001-135 (a link is recorded with its in-scope target); `tasks/001-146/notes.md` (its first-observation timing evidence).

Name the cause first with evidence (which runs happen and why the third: the link spelling and the target each first observed in a different run, a watch batch for the target, or a timing race in the test). Then fix the product if the third run is avoidable without weakening "never stores the run's pass under the key with the present file"; if the bound in the test is wrong for links, say why and change the bound and D4's wording.

Own: `src/core/scheduler/observed.ts` and what it needs in `src/core/scheduler/`, `test/scheduler/first-observation.test.ts`, D4. Do not run `npm run build`.

Done when: the cause is named; the case passes ten runs in a row alone at load 40 or more; its stored result stays `fail/current` under the key with the file; a second worktree still inherits only the re-run.

## 001-152 re-review of wave 13

Use /reviewer on gpt-6.1-sol. Output `reviews/wave-13b.md`. Range `e55ccd6..6418a6b`. Second round: are `reviews/wave-13.md` B1 (closed by 004-18's per-lane mark in `src/core/daemon/escaped.ts`, 0.1.51) and B2 (001-151, 0.1.50) closed, and S1 (001-151) and S2 (004-18) addressed? Re-run the first round's B1 barrier probe and B2 probe (a project with its own config file) against `6418a6b`; check that 004-18's slow Vitest instance is stamped (it is built through `createRecoveringRunner` → `createVitestAdapter` → `#start`, which calls `sources.attach(vitest)`) with a transient-transform probe on a slow file; probe a pid reused between the scan and the first SIGTERM with a controlled process table. Last round on this slice: blockers go to the human. Spec 004's other rows in the range (004-15, 003-40) are not under review. Same rules as 001-149.

## 001-153 the released-bundles step-down never misses its successor at low load

Use /worker. Shape: fix. Planned.

Reported 2026-10-09 by the 002/003/004 coordinator's 0.1.51 gate on Node 22: `test/daemon/step-down.test.ts` "a released 0.1.31 daemon, from before the request, is sent stop and exits after its tier" failed with "the successor serving not met in 60000 ms", once alone, then passed four times alone at load 6 to 24. 001-145 fixed the sibling case in `handover.test.ts` by waiting for the successor at the lock; a 60 s miss at low load is not that race. Name the cause (log the successor's spawn, its lock attempts and its notes) before changing anything.

Own: `test/daemon/step-down.test.ts`, `test/daemon/step-down-helpers.ts`, `src/core/daemon/` step-down, successor and lock paths, D10 if a rule changes. 001-156 (0.1.57) found this is not the liveness flap; only the slow daemon start under load is shared. Do not run `npm run build`. Done when: the cause is named with evidence; the case passes ten runs in a row on Node 22 and on Node 24 (`PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH`).

## 001-151 every Vitest project's server is stamped, so no transient transform is stored as current

Use /worker. Shape: repair. From `reviews/wave-13.md` B2 (001-149; the report lands on `cez/96885322` and then main, read it when it is there). Agreed with the 002/003/004 coordinator: limited to `src/runners/vitest/sources.ts` and the plugin wiring lines in `src/runners/vitest/adapter.ts`; 004-18 is changing `adapter.ts` for a second (slow) Vitest instance, and whichever lands second rebases.

The defect (proven by the reviewer with the real adapter and scheduler, `observe.runtimeInputs: true`): 001-146's `SourceStamps` Vite plugin goes in through `createVitest`'s root overrides, so a project that has its own config file (for example `vitest.unit.config.ts` in a `projects` list) has a Vite server without it. A transform taken during `closure()` while the file briefly held other (passing) bytes, then restored to failing bytes, was stored as file and test current PASS; a fresh adapter reports FAIL. Root config, inline projects, a rename replacement and a symlink target were checked and are fine.

Outcome: every Vite server a Vitest instance creates for a project, whatever its config source, records the bytes it read and is checked before each run and in `invalidate()`, as 001-146 intended; the plugin attaches per instance, so a second Vitest instance (004-18's slow lane) is covered too.

Own: `src/runners/vitest/sources.ts`, the plugin wiring in `src/runners/vitest/adapter.ts`, tests under `test/runners/vitest/` and `test/integration/`, D4 if its paragraph on the bytes Vite read changes. Do not run `npm run build`.

Done when: the reviewer's probe, as a test with a project configured through its own config file, fails without the fix and passes with it; 001-146's tests and the root, inline-project, rename and symlink controls still pass; the report says how the plugin reaches each project's server and that it attaches per Vitest instance.

## 001-154 each Vitest project server's cached transforms are checked against that server's own stamps

Use /worker. Shape: repair. From `reviews/wave-13b.md` B2 (001-152). Decided by the human (2026-10-09): fix, then a third review round (001-155).

The defect (proven twice, observation on and off): two projects with their own config files (`vitest.a.config.ts`, `vitest.b.config.ts`) import the same `src/mod.ts`. Project A's closure walk caches a transform of transient passing bytes; the file is restored; project B's load stamps the restored bytes into the one `Map<AbsolutePath, Stamp>` in `src/runners/vitest/sources.ts`, overwriting A's. `stale()` unions transformed paths and compares them with that one stamp, so A's cached transient transform looks current: the scheduler stores A current PASS and B current FAIL while a fresh adapter fails both.

Outcome: stamps, and the unknowns from before attachment, are kept per plugin container (per server and environment), not only per path; each cached transform is compared with its own container's stamp; a mismatch in any container invalidates that absolute path in every project (conservative); `loadedSince` evidence is per container; attachment stays idempotent per instance. A result whose server's executed bytes are uncertain is never stored as current.

Read: `reviews/wave-13b.md` B2 (its probe steps), `reviews/wave-13.md` B2, `tasks/001-146/notes.md`, 001-151's commits (`SourceStamps.attach`), D4's paragraph on the bytes Vite read.

Own: `src/runners/vitest/sources.ts`, the stamp wiring in `src/runners/vitest/adapter.ts` only if needed (001-150 is running in `adapter.ts`; keep that edit minimal and say which lines), tests under `test/runners/vitest/` and `test/integration/`, D4. Do not run `npm run build`.

Done when: the reviewer's two-separate-config-project probe is a scheduler regression with observation on and off, plus a fresh-adapter control, failing without the fix and passing with it; the root, inline and one-separate-config-project controls (001-146, 001-151) still pass; the same probe repeated in 004-18's slow instance passes.

## 001-155 third review of wave 13's stale-transform slice

Use /reviewer on gpt-6.1-sol, after 001-154 lands. Output `reviews/wave-13c.md`. Range: from `6418a6b` to 001-154's landing (0.1.54); 0.1.53 (001-148, 001-150, which also reworked `sources.ts` and added `gate.ts`) is in the range and under review too. The worker's slow-instance repeat passed with and without the fix (a fresh instance reads disk), so it proves nothing: build a slow-instance probe where the slow instance's own cached transform is the transient one. Question: is `reviews/wave-13b.md` B2 closed, and is there any other way, in any configuration of Vitest projects, servers or instances, for a cached transform's bytes to differ from the bytes a stored result's key names? Also verify the 002/003/004 coordinator's wave-13b S2 fix (`248723c`, `src/core/daemon/escaped.ts` `terminate`) with the two-target controlled table. Decided by the human: blockers from this round go to the human again.

## 001-156 a loaded host never flaps "no daemon is validating" / "validating again"

Use /worker. Shape: fix, reproduce first.

Evidence: the board row (both coordinators' gates since 0.1.45; `test/e2e/worktrees.test.ts`'s second-worktree PostToolBatch prints `SQUEAL · a daemon is validating again at revision 0` where silence is expected; live sessions show "no daemon is validating" then "validating again" headers during builds at load 50 to 160). Possibly the same cause as 001-153 (`test/daemon/step-down.test.ts`'s released-0.1.31 case missed its successor for 60 s once on Node 22): check it.

Read: spec D9 (registration, the turn and its notes), D10 (liveness, heartbeats, pings), D12 (dead-daemon handling: "hooks still serve status and..."); `src/core/delivery/format.ts` (the dead-daemon and validating-again notes), wherever a hook decides a daemon is not validating (ping timeout, heartbeat age in the store), and the daemon's heartbeat writer.

Questions to settle first, with a test that reproduces it (an event-loop-blocked or starved daemon, or a ping/heartbeat deadline shorter than a loaded host's stall): which signal says "not validating" (a ping timeout, a heartbeat older than N), how short its deadline is against a 1 to 3 s stall, and why the next boundary says "validating again" for revision 0 in a worktree that never saw it stop. Fix the cause; a stale-looking heartbeat on a live process should not produce a pair of transitions an agent reads as an outage.

Own: `src/core/delivery/`, `src/core/daemon/` heartbeat and liveness, `src/harness/shared/` liveness checks (ask before `src/harness/codex/`), tests under `test/delivery/`, `test/harness/`, `test/daemon/`, `test/e2e/` helpers, D9/D10/D12. Do not run `npm run build`.

Done when: the cause is named with evidence; a test with a stalled daemon (or a delayed heartbeat) shows no false "not validating"/"validating again" pair within the stall the fix tolerates, and a genuinely dead daemon is still reported within its stated time; `test/e2e/worktrees.test.ts` passes ten runs in a row at load 60 or more; the report says whether 001-153 shares the cause.

## 001-157 every cached transform of a project file, query variants included, is checked against its own evidence

Use /worker. Shape: repair. From `reviews/wave-13c.md` B1 and S1 (001-155). Decided by the human (2026-10-09): fix, then a fourth review (001-158).

The defect (proven, observation on and off, fast and slow instance): `import "../src/mod.ts?variant"` caches a transform under its own module ID. `SourceStamps.#stamp` skips every ID with `?`, and `cachedFiles` collapses variants to the physical file, so a variant warmed on transient bytes is compared with no stamp, or with the plain variant's, and a false current PASS is stored. The reviewer's steps are in the report.

Outcome: within each container, source evidence is kept per cached module ID, query variants of physical project files included, each associated with its physical path; every executable cached variant is compared with its own evidence; a mismatch invalidates every variant of that path in every container; an uninstrumentable transform of a project file is invalidated before the run or makes its result unknown. Do not strip the query and keep one stamp per path (that recreates the overwrite within one container).

Also, so this slice stops yielding one escape per round: inventory in `tasks/001-157/notes.md` every way Vite 8 and Vitest 5 can hold a transform or module of a project file (module graph IDs with queries, `?raw`/`?url`/`?inline`, virtual and `\0` IDs that map to a file, `fsModuleCache`, the SSR and client environments, `import.meta.glob`, `vi.mock` factories, dependency optimizer output, workers), and for each say whether it is now checked, invalidated before every run, or makes results unknown, with a test for each class that can hold project bytes.

S1: replace `test/integration/project-config-stamps.test.ts`'s slow regression with the reviewer's discriminating probe (the slow adapter's own `closure` plants A's transient transform, disk is restored, B's restored transform is warmed through the same adapter, then the real slow run): it must fail on `bc4ceb1` (before 001-154) and pass now.

Own: `src/runners/vitest/sources.ts`, the stamp wiring in `src/runners/vitest/adapter.ts` only if needed, tests under `test/runners/vitest/` and `test/integration/`, D4. Keep 001-150's mid-run movement log and 001-154's per-container controls. Do not run `npm run build`.

Done when: the reviewer's B1 probe is a scheduler regression with observation on and off plus a fresh-adapter control, a plain/query pair in one container, and the same planted in the slow instance itself, each failing without the fix; S1's regression discriminates; every inventoried class is covered.

## 001-158 fourth review of the stale-transform slice

Use /reviewer on gpt-6.1-sol, after 001-157 lands. Output `reviews/wave-13d.md`. Range: from 0.1.54's landing to 001-157's. Is `reviews/wave-13c.md` B1 closed and S1 addressed; is 001-157's inventory complete and true (probe each class it lists, and look for classes it misses); can any cached module of a project file still execute bytes other than those its stored result's key names. Decided by the human: blockers go to the human. Also in range: 001-156 (0.1.57, a starting daemon after a spawn); its `test/harness/starting-daemon.test.ts` 750 ms case failed once beside the e2e suite and passed 5 of 5 alone at load 40 to 45, so check it for load sensitivity.

## 001-159 a revert-and-restore no revision names discards every cached transform before the next run

Use /worker. Shape: slice. From `reviews/wave-13d.md` (001-158). Decided by the human (2026-10-09): the blunt rule, then a fifth review (001-160).

Four review rounds each found one more Vite/Vitest cache that can keep transient bytes of a project file when it changes and changes back within one watcher batch (wave-13 B2 separate project configs, wave-13b B2 shared path stamp, wave-13c B1 query variants, wave-13d B1 virtual-module inputs and B2 processed CSS `@import`, S1 the dependency optimizer through an alias). Every case needs the same trigger: the watcher saw the file touched but its final hash equals the old one, so no revision names it. Stop chasing caches one by one.

Outcome: whenever a watch batch (or a scan) touched a project file whose hash ended unchanged, every Vitest instance's cached transforms and module graph (every project, every environment, the fast and slow instances), its `globalSetup` state and the dependency optimizer's output are discarded before the next run of any lane; or the instance is recreated, if that is the only reliable way. The per-module stamps of 001-146 to 001-157 stay as the fast path for every other case. The discard costs a re-transform only on this rare event; say how rare from a measurement (how often a batch has a touched-unchanged file in a normal agent session, e.g. an editor's atomic save, `git checkout` of the same content, a formatter that rewrites identical bytes).

Settle first: where the watcher drops the event today (the batch, the change feed, the revision builder), how a touched-unchanged path reaches the scheduler or runner without becoming a revision, and which files count (only paths some closure or observed set names, or any project file; prefer any file under the worktree that is not ignored, as the conservative choice, unless a measurement shows that is too frequent). A run already in flight when the event arrives: its files' results are withheld (unknown with a reason), as 001-146 does for a file that moved during a run.

Read: `reviews/wave-13d.md`, `reviews/wave-13c.md`, `reviews/wave-13b.md`, `reviews/wave-13.md` (every probe), `tasks/001-157/notes.md` (the inventory), `tasks/001-146/notes.md`; D2 (watcher, revisions), D4 (the bytes Vite read), D5; `src/core/watcher/`, `src/core/scheduler/`, `src/runners/vitest/`.

Own: `src/core/watcher/` and `src/core/scheduler/` only for passing the touched-unchanged signal; `src/runners/vitest/` for the discard; `src/core/types/` additively; tests under `test/watcher/`, `test/scheduler/`, `test/runners/vitest/`, `test/integration/`; D2, D4. Also take wave-13d S2: replace `test/harness/starting-daemon.test.ts`'s wall-clock upper bounds with what the spawn and registration order prove. Do not run `npm run build`.

Done when: every probe from the four review reports (two separate configs, shared path stamp, query variant, virtual input, CSS `@import` with and without declared inputs, optimizer through an alias, slow instance's own cache) is a scheduler regression, observation on and off, each storing the result a fresh adapter gives; the ones the per-module stamps already catch still pass; a test proves a run in flight withholds its results on the event; the measurement of how often the event happens is in `tasks/001-159/notes.md`; D4 states the rule and what it costs.

## 001-160 fifth review: the discard rule

Use /reviewer on gpt-6.1-sol, after 001-159 lands. Output `reviews/wave-13e.md`. Range: from 0.1.58's landing to 001-159's (0.1.64). Two decisions to judge: a touch recreates no project and re-lists no test files (it re-fetches only closures naming a touched path); a run's own write of the touched path (the recorder's written set) does not withhold its result, with observation on only. The 002/003/004 coordinator's 0.1.59 to 0.1.63 are in the range but not under review, except where they meet 001-159 (the slow lane and `slow-instance.ts`). Question: is there any way left for a cached Vite/Vitest state (transform, module graph, executed setup, optimizer output, anything else) to run bytes other than those a stored result's key names, now that every touched-unchanged batch discards them all? Probe the rule itself (when is a touched-unchanged file not seen: an event the watcher coalesces away entirely, a change outside the watched set, a change during the discard, a lane mid-run) rather than another cache class. Decided by the human: blockers go to the human.

## 001-164 the plugin id is `squeal@hearsay`, one constant

Use /worker. Shape: slice. From `research/release-hub.md` (001-163) and the human's decision (2026-10-09): one private hub repository `hearsay-tools/marketplace` (created, README only), marketplace name `hearsay`, so the installed plugin id becomes `squeal@hearsay`.

Outcome: every place that names the plugin id uses one exported constant derived from the hub's marketplace name: `src/cli/init.ts` (the `enabledPlugins` entry), `src/cli/codex/init.ts` (`CODEX_PLUGIN_ID`), `src/cli/codex/hash.ts` (`PLUGIN_KEY_SOURCE`), `src/cli/codex/trust.ts`, `src/cli/remove.ts`'s instructions, both plugin READMEs, the skill's references, and the tests. A repository initialized under the old id still works: `squeal remove` and `squeal init` recognize `squeal@squeal` as the previous id (remove it, write the new one), and `init --harness codex --trust` says when the old id's hooks are still trusted.

Settle and record in the report: this repository's own `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` (named `squeal`) stay for local development from a checkout, or are renamed. Two marketplaces named `hearsay` cannot both be added, and a checkout install under another name gives another id. Prefer keeping them as a dev-only marketplace with a distinct name, and say what `squeal init` writes for a dev install.

Read: `research/release-hub.md` (the migration section), D9 and D12's install text, `src/cli/`, `plugins/*/README.md`, `test/cli/`.

Own: `src/cli/`, `src/harness/` only for the id, `plugins/*/README.md` and the skill's references (not `dist`), the two in-repo marketplace manifests, tests under `test/cli/` and `test/harness/`. Do not run `npm run build`.

Done when: no `squeal@squeal` remains outside the previous-id handling and its tests; `squeal init` (Claude Code and Codex) writes `squeal@hearsay`; a repository initialized with `squeal@squeal` is migrated by `squeal init` and cleaned by `squeal remove`; the Codex trust hash uses the new key and a test pins its value.
