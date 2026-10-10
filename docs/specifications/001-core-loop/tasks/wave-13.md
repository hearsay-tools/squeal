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

## 001-161 a daemon starting on a shared store never exits on "database is locked"

Use /worker. Shape: fix, reproduce first. From 004 `lessons.md` D9 (004-17 dogfooding): at 06:15:37 a cezarion daemon starting beside 0.1.55 and 0.1.56 daemons exited on `database is locked`. 001-141 (0.1.44) shortened the prune's holds and made `open` take no write lock, so this is another holder, or a startup path that runs without a busy timeout (the daemon lock, a migration, the first heartbeat, the bootstrap seed, the 004 slow slot).

Read: `tasks/001-141/notes.md`, `src/core/store/` (open, connection, migrations), `src/core/daemon/` startup and `lock.ts` (001-153 changed the successor's lock attempts), D6, D8, D10.

Name the holder and the waiter with a test that starts a daemon beside two busy daemons on one store, repeatedly; fix so every startup statement waits within the busy timeout or retries, and no startup transaction holds the write lock long. Own: `src/core/store/`, `src/core/daemon/` startup (not the slow slot in `src/core/slow/`, the 002/003/004 coordinator's; ask), tests under `test/store/` and `test/daemon/`, D6/D8/D10. Do not run `npm run build`. Done when: the cause is named; the repeated test starts every daemon without a lock exit.

## 001-166 a worktree's first walk of linked directories makes no revision

Use /worker. Shape: fix. The board row's evidence (004-39): bootstrap seeds only git-listed paths, so the change feed's first walk under symlinked directories (`.agents/skills/*`, `test/fixtures/node-test/*/node_modules`) records about 23 spurious adds as revision 1. Fix: seed files the start walk finds under linked directories without a revision, as bootstrap does for git-listed ones; also check the watch-triggered variant (`#reconcilePaths(moved)` after a tier, `scheduler.ts:466`). Own: `src/core/watcher/` start walk and `src/core/scheduler/bootstrap.ts`, tests under `test/watcher/` and `test/scheduler/`, D2. Do not touch `src/core/watcher/parcel-backend.ts` (001-167). Do not run `npm run build`. Done when: a worktree with a linked directory starts at revision 0 with no spurious adds, and an edit under the link still makes a revision.

## 001-167 the parcel backend watches extra files behind a symlinked directory

Use /worker. Shape: fix. The board row's evidence (004-38): `subscribeAll` in `src/core/watcher/parcel-backend.ts` subscribes an extra's parent, which can be a link (`dist -> real-build`), and fails with "inotify_add_watch ... Not a directory" on Linux; on macOS, FSEvents likely reports canonical paths that `files.has(path)` drops. Fix: subscribe hidden extras at `realpath(parent)` and map events back to the declared extra paths. Own: `src/core/watcher/parcel-backend.ts`, tests under `test/watcher/`. Do not touch the start walk (001-166). Do not run `npm run build`. Done when: a parcel-backend test on Linux with `dist -> real-build` reports a rebuild of `real-build/index.js` as `dist/index.js` within one batch, with no watch error.

## 001-168 no result recorded while a touch could still be pending; the optimizer rebuilt at every start; no own-write exemption

Use /worker. Shape: repair. From `reviews/wave-13e.md` (001-160) B1 to B3. Decided by the human (2026-10-09): fix, then a sixth review (001-169).

- **B1:** remove 001-159's own-write exemption. A run that heard a touch withholds its files whatever it wrote. A test that rewrites a worktree file with identical bytes on every run is then reported unknown with a reason naming the path; say so in the skill's troubleshooting text, with the remedy (write outside the worktree or under an ignored path, or declare the file), and keep the fixture-rewrite test, asserting the honest unknown, not liveness.
- **B2:** before a run's results are recorded, a completion barrier reconciles the paths touched over the run's interval (a stat pass of what the run's closures and observed sets name, or the change feed flushed up to the run's end), and a touch found there withholds the run as a heard touch would. If a touch can still arrive after recording, retire the suspect shared result rows and queue a forced re-run, never only a local unknown (the shared key would promote or inherit it again). Keep the no-relist choice.
- **B3:** every Vitest instance start (fast and slow, initial and replacement) rebuilds optimizer output that could hold project bytes (`forceOptimizeDeps`, or delete the instance's optimizer cache first), or persists and verifies source evidence per bundle; measure the start cost on this repository and on a cezar clone (env -u every `CEZ_*`, cwd in the clone through a subshell), and record it in D4.

Read: `reviews/wave-13e.md` (every probe), `reviews/wave-13d.md`, `tasks/001-159/notes.md`, D2, D4, D5.

Own: `src/runners/vitest/`, `src/core/scheduler/` for the barrier (ledger, runner work, batch), `src/core/daemon/slow-instance.ts` only if the slow instance's start needs it (by the agreement 001-159 used), the skill's references, tests under `test/runners/vitest/`, `test/scheduler/`, `test/integration/`; D2, D4. Do not run `npm run build`.

Done when: each of the review's three probes is a scheduler regression (observation on and off) with a fresh control, failing without the fix; B2's includes a result lookup after the late touch and an inheritance control; B3's covers close/reopen and a forced checkpoint; every earlier review's probe still passes; the start-cost measurement is in D4.

## 001-169 sixth review: the stale-transform slice after 001-168

Use /reviewer on gpt-6.1-sol, after 001-168 lands. Output `reviews/wave-13f.md`. Range: from 0.1.64's landing to 001-168's. Are `reviews/wave-13e.md` B1 to B3 closed; can any result still be stored current while its run executed bytes other than its key names, with the conservative rules now in place (withhold on any touch over a run's interval, rebuild optimizer output at every start)? Decided by the human: blockers go to the human.

## 001-170 an inherited failure stands only once the receiving worktree confirms it

Use /worker. Shape: slice. Decided by the human (2026-10-09, `status.md`, relayed by the 002/003/004 coordinator).

Outcome: when a lookup finds another worktree's `fail` for a key, the check is pending, not current: its inherited outcome and failure text are available to `squeal why` ("inherited FAIL from <worktree> at <commit>, being confirmed"), no transition or known failure is delivered for it, and its file is queued at normal priority. The local run's result replaces the shared row (results are one row per check and key, `INSERT OR REPLACE`), so a local pass heals every worktree under that key and a local fail is delivered as usual. When a row's outcome flips under one key (fail replaced by pass, or the reverse), a flaky note is recorded on the check and shown by `why` and in the report line. An inherited pass stands at once as today. A slow file's inherited fail is confirmed by the slow tier when it next runs (004 D2's triggers) and stays pending until then; if that needs `src/core/scheduler/slow-tier.ts`, stop and ask (the 002/003/004 coordinator sequences it).

Read: D5, D6 (state, transitions, delivery), `src/core/scheduler/ledger.ts` (`lookup`, `applyResults`), `src/core/state/` (derive, sink), `src/core/store/repos/results.ts`, `src/cli/why.ts`.

Own: `src/core/scheduler/` (ledger, tiers), `src/core/state/`, `src/core/store/` additively (the flaky note: a column or a meta row; ask before a schema change), `src/cli/why.ts`, `src/core/delivery/` format, tests, D6. Do not run `npm run build`.

Done when: a scheduler test inherits a fail into a second worktree: pending, nothing delivered, its file runs; a local pass replaces the row and the first worktree's state becomes current pass too, with a flaky note; a local fail is delivered once; an inherited pass is current at once with zero runs; a slow file's inherited fail stays pending until the slow tier runs.

## 001-171 a new failure is re-run once before it is trusted

Use /worker. Shape: slice. After 001-170 (same files). Decided by the human (2026-10-09).

Outcome: a worktree's own new failure (a check whose stored outcome becomes `fail` from `pass`, `unknown` or none, under its current key) is reported at once as today, then its file is re-run once in the next tier, forced, at normal priority. If the re-run passes, the pass replaces the row and the check is reported `FAIL -> PASS` with 001-170's flaky note; if it fails again, nothing more is reported. A failure is re-run once per key, never in a loop; a forced `run --all` does not trigger re-runs. Own and Read as 001-170. Done when: a test with a file failing once then passing reports FAIL then FAIL -> PASS with the flaky note and one re-run; a file failing twice reports one FAIL and is re-run exactly once; the re-run does not repeat for the same key.

## 001-172 research: how long `squeal status --wait` takes for one file's result on a loaded host

Use /researcher. Output: a dated section in `docs/specifications/001-core-loop/lessons.md` and probes under `research/probes/status-wait-latency/` (throwaway). From an agent's feedback (2026-10-09): it ran neighbouring suites itself instead of waiting, partly because results arrive slowly at load 100 to 170.

Measure, on this repository and a cezar clone (every cezar command with each `CEZ_*` unset and its cwd in the clone, never your session's shell), with a daemon you start in a scratch worktree: the time from an edit to `status --wait` returning that file's result, for (a) an idle daemon, (b) during the baseline, (c) during a backlog tier of unrelated files, (d) during a slow file, each at the host's load as it is and once with bounded extra load (at most 8 burners, each under `timeout`, alive only during a measured run; `pgrep` that none remain). Break the time into watcher batch, runner part, queue wait, tier start, run and delivery. Name what dominates and whether an edit's own file is ever queued behind work it should precede (D5's priorities).

Done when: a table of the cases with medians, the dominant stage per case, a recommended wait to quote in the skill (for example "`--wait 120000` on a busy host"), and any priority defect found filed as a proposed row.

## 001-173 `squeal why` names the run log that holds a check's console output

Use /worker. Shape: slice. Decided by the human (2026-10-09): `why` points to the output, not cites it; optionally a flag prints it.

Outcome: `squeal why <check>` adds a line naming the run log of the run that produced the shown result (`<common-dir>/squeal/runs/<run-id>/...`, the file the Vitest reporter writes, which holds the run's captured `console` lines), and says that log covers the whole run, not only this check. `squeal why <check> --include-logs` also prints that run's console lines that belong to the check's test file (as the reporter tagged them), capped, with the cap stated. A result inherited from another worktree names that worktree's run log, which is in the same common dir. A run log pruned or absent says so. Read: D6 (reports), D12, `src/runners/vitest/reporter.ts` (`console`), the `why` command in `src/cli/main.ts` and its formatter, `plugins/*/skills/squeal/references/commands.md`. Own: `src/cli/`, `src/core/delivery/` format for `why`, the reporter only if the log needs the test file tag, the skill's `commands.md`, tests. Do not run `npm run build`. Done when: a test shows the log path for an own and an inherited result, `--include-logs` prints only that file's lines, and a pruned log is reported.

## 001-174 the skill and primer show the red/green workflow and waiting on one file

Use /worker. Shape: docs. After 001-172 (to quote its measured wait). Outcome: the skill (`plugins/*/skills/squeal/SKILL.md`, references) has a short worked example: revert the fix, `squeal status --wait <ms>` (the revert is its own revision; the result is the old FAIL), restore, wait again; and says that re-running neighbouring suites duplicates what Squeal is already running, while the repository's own gate is still the agent's to run. Keep the primer within D9's cap; change it only if the measurement shows agents give up too early. Follow `docs/styleguide.md`'s agent-text rules. Own: the skill and its references, the primer text in `src/harness/shared/` only if needed, D9 if the primer changes. Done when: the example and the wait are in the skill, and `test/harness/` primer and skill tests pass.

## 001-175 review of the unreviewed 001 rows since 0.1.54

Use /reviewer on gpt-6.1-sol, beside 001-169. Output `reviews/wave-13g.md`. So the next hub release carries only reviewed 001 work (`docs/process.md` 6a). Rows: 001-156 (0.1.57, a registration after a spawn reports a starting daemon), 001-153 (0.1.59, each successor lock attempt on its own connection), 001-164 (0.1.62, the plugin id `squeal@hearsay`, init's migration, Codex trust), 001-161 (0.1.66, one sink call per checkpoint; a starting daemon's 120 s busy timeout), 001-167 (0.1.66, parcel extras at `realpath(parent)`), 001-166 (0.1.65, the start seed under linked directories). Find each row's commits on main by its id. Not in scope: 001-159 and 001-168 (001-169's), and the other coordinator's rows.

Questions: can any of these store or show a stale result as current, kill or orphan the wrong process, exit or lose a daemon wrongly, or break an existing install (the `squeal@squeal` migration under either harness)? 001-161: does merging a checkpoint's applied entries ever change a state or transition (a check applied twice, unknowns between), and does the 120 s start timeout ever block a hook? 001-153: can two successors both serve, or none for longer than one retry? 001-166: can a real addition at start be missed? Decided by the human: blockers go to the human.

## 001-176 Squeal's Vitest instances run with the dependency optimizer off

Use /worker. Shape: repair. From `reviews/wave-13f.md` (001-169) B3, B4, S1, N1, N2. Decided by the human (2026-10-09): turn the optimizer off, then a seventh review (001-177).

Six review rounds found Vite's dependency optimizer holding project bytes outside the module graph: a separately configured project's bundle reused after restart (B3), a bundle built before the startup key scan (B4), and an ordinary edit of an aliased source leaving the old bundle in place (S1, pre-existing). Vitest leaves it off by default; this repository and cezar do not enable it.

Outcome: every Vitest instance Squeal creates (fast and slow, every project, root or own config file, every environment) runs with the dependency optimizer off (`test.deps.optimizer.ssr.enabled` and `.client.enabled` false, and whatever Vitest 4 and 5 need so it is effectively off per project), verified on the effective project config, not only the `createVitest` argument, as 001-157 did for `fsModuleCache`. 001-168's `forceOptimizeDeps` goes, since there is nothing to rebuild. When a project's own config enables the optimizer, `squeal status` and the registration header say once that Squeal runs it without the optimizer and why, and the reason sits in D4.

Also: N1 (D4 still suggests declaring a fixture writer's file as a remedy; align it with the skill: write outside the worktree or under an ignored path) and N2 (the missing 001-168 amendment line in `status.md`).

Read: `reviews/wave-13f.md`, `reviews/wave-13e.md`, `reviews/wave-13d.md` S1, `tasks/001-157/notes.md` (`fsModuleCache`), `tasks/001-168/notes.md`, D4.

Own: `src/runners/vitest/`, the status/header note in `src/core/delivery/` or `src/core/state/` (additive), the skill's references, tests under `test/runners/vitest/` and `test/integration/`, D4, `status.md` (N2 only). Do not run `npm run build`.

Done when: B3 (separate config, restart and forced checkpoint), B4 (pre-scan start, real daemon) and S1 (ordinary edit of an aliased source) are regressions, observation on and off, each storing what a fresh adapter without the optimizer gives; a test reads the effective optimizer setting of a root and a separately configured project as off; the note appears for a config that enables it; every earlier probe still passes.

## 001-177 seventh review: the stale-transform slice with the optimizer off

Use /reviewer on gpt-6.1-sol, after 001-176 lands. Output `reviews/wave-13h.md`. Range: from 0.1.69's landing to 001-176's. Are `reviews/wave-13f.md` B3, B4 and S1 closed; is the optimizer off in every project, environment and instance, as Vitest actually resolves it; can any cached state still run bytes other than a stored result's key names. Decided by the human: blockers go to the human.

## 001-181 the optimizer note follows the config, and the slow regression discriminates

Use /worker. Shape: repair. From `reviews/wave-13h.md` (001-177, PASS) S1 and S2. S1: the registration note that Squeal runs Vitest without the optimizer survives a config that turns the optimizer back off, and still says the config turns it on; the note must be recomputed from each instance's effective config at each start and cleared when no config enables it. S2: `test/integration/`'s committed slow-instance regression passes against the pre-001-176 slow adapter because the fast harness seeds the old optimizer cache; give it the reviewer's precondition (clear the cache, then build on NEW) so it fails on the old adapter and passes now. Own: `src/runners/vitest/optimizer.ts` and the note's wiring, the test. Do not run `npm run build`. Done when: a test turns the optimizer on then off and the note goes; the slow regression fails with 001-176 reverted.

## 001-182 research: the revert-restore current PASS seen once in a full gate

Use /researcher. From `reviews/wave-13h.md` (Verification): in the reviewer's full gate, `test/integration/revert-restore.test.ts` asserted a current PASS after its run loaded the reverted bytes; it did not reproduce alone, nor in eight instrumented runs under load (all correctly unknown). Find what sequence produces it: run the test repeatedly under the full gate's concurrency and load (`--maxWorkers=4`, other files beside it), instrument the store and the stamps, and name the cause, or bound how rare it is with evidence. If it is a real stale current PASS, propose the fix row. Output: a dated section in `tasks/001-182/notes.md`.

## 001-183 review of 001-170, 001-171 and 001-173

Use /reviewer on gpt-6.1-sol, after 0.1.73 lands. Output `reviews/wave-13i.md`. So the next hub release carries only reviewed 001 work. Rows: 001-170 (0.1.71, an inherited fail held until the receiving worktree confirms it; a local pass heals every worktree under the key; flaky notes), 001-171 (0.1.73, a new failure re-run once, capped at 8 per tier, fast files only), 001-173 (0.1.70, `why` names the run log; `--include-logs`). Find each row's commits on main by its id. Questions: can a held or healed state ever show a stale result as current, or hide a real failure from the agent (a fail never delivered); does the heal rewrite another worktree's state in a way its own next run contradicts; can the re-run loop, double a cost the cap should stop, or re-run a forced or red-phase failure; does `--include-logs` print another file's lines or a pruned log's. One test case is skipped for 003-43 (`observed-growth.test.ts`); judge whether the heal makes that window worse in production, not only in the test. Decided by the human: blockers go to the human.

## 001-184 an edited file's result is current when its own run ends, not its tier's

Use /worker. Shape: slice. From `lessons.md` "`status --wait` on a loaded host" (001-172), defect 31: results are stored only when a tier ends, so on cezar a 20 ms edited file waited 187 s and a 0.5 s file 113 s for backlog files in the same tier. Outcome: the result of a file an edit reached is stored and delivered when that file's module ends (Vitest's per-module end, node:test's per-file end), keeping D5's stability check per file and 001-168's completion barrier per file (the inputs that file's key names), or such a file never shares a tier with files whose last-known duration is far above its own; choose with evidence and record it in D5. Read: D5, `src/core/scheduler/` (tiers, ledger, stability), `src/runners/vitest/reporter.ts` (`onTestModuleEnd`), 001-168's barrier, 004's slow lane. Own: `src/core/scheduler/`, the runners' result streaming if needed (ask before `src/runners/node-test/`, the 002/003 coordinator's), tests under `test/scheduler/`, D5. Do not run `npm run build`. Done when: a test with a 20 ms edited file and a held slow file in one tier sees the edited file's result current before the slow file ends; the stability check and the barrier still withhold a file whose own inputs moved.

## 001-185 `status --wait` never ends quiet on a revision older than the edit

Use /worker. Shape: fix. Defect 30: 19 of 84 waits returned quiet at the revision before the edit (15 of 18 on cezar idle), because the wait settles 750 ms after its own start while the edit's revision committed 0.9 to 3.1 s after the edit. Outcome: quiet is decided against a revision the daemon recorded after the wait started (or the daemon is asked to flush its watcher batch first), never after a fixed delay. Read: `src/cli/status-wait.ts`, the daemon's batch and revision path, D6. Own: `src/cli/status-wait.ts`, a daemon request if needed (`src/core/daemon/`, additive), tests. Do not run `npm run build`. Done when: a test that holds the revision transaction for 3 s after an edit gets no quiet at the earlier revision, and an idle wait with no edit still returns promptly.

## 001-187 inherited and re-run failures never strand, skip or heal falsely

Use /worker. Shape: repair. From `reviews/wave-13i.md` (001-183) B1, B2 (the stopgap), B3, S1. Decided by the human (2026-10-09): repair, then a re-review (001-189).

- **B1:** after a heal of a file whose checks flipped opposite ways, the receiving daemon's ledger, not only its sink, learns the file's new held state: its equal-key `resultKey` shortcut is invalidated and the file is queued for confirmation at normal priority; a `run --all` treats a held file as not done.
- **B2 (stopgap in this lane):** no heal from a result whose project environment has unresolved observed growth (a newly observed preload not yet in the environment key); the result is stored for its own worktree only. The 002/003/004 coordinator's 003-43 fixes the root and re-enables the skipped `observed-growth` case; do not edit that test or `src/runners/node-test/`.
- **B3:** newness is judged against the pre-apply known state and the prior rows at the final stored key, so a failure stored through observed growth counts, inside the same per-tier cap.
- **S1:** a pending re-run and the once-per-key memory survive a daemon restart (persisted with the queue or as a meta row).

Read: `reviews/wave-13i.md` (each probe and fix scope), `tasks/001-170/notes.md`, `tasks/001-171/notes.md`, D6. Own: `src/core/scheduler/` (ledger, rerun, records), `src/core/state/`, tests under `test/scheduler/` and `test/integration/`, D6. 001-184 is changing `src/core/scheduler/` tiers and ledger at the same time; keep edits small and name the lines in your report. Do not run `npm run build`. Done when: each blocker's probe is a regression failing without the fix; S1 by a restart test.

## 001-188 `squeal why` names the run that produced the shown result

Use /worker. Shape: repair. From `reviews/wave-13i.md` B4, S2, S3, N1. B4: after a real revert, `why` named a newer run with a different key as the producer of an older current result; resolve the producing result by its key and its run identity, beyond the 20 rows `why` lists. S2: the console filter's file label is ambiguous as a prefix; match the exact label. S3: `--include-logs` says plainly when a node:test run has no captured console, or captures it if the node:test reporter already exposes it (ask the 002/003/004 coordinator before editing `src/runners/node-test/`). N1: a held check is found by a name fragment as by its full name. Own: `src/core/status/`, `src/cli/`, `src/core/run-log.ts`, tests under `test/status/` and `test/cli/`. Do not run `npm run build`. Done when: the revert probe names the right run; the prefix case and the node:test case have tests.

## 001-186 `status --wait` ends when the edit's own files are done

Use /worker. Shape: slice. After 001-185 (same file). Decided by the human (2026-10-09). This is the blocking `squeal status --wait`; tool-boundary delivery is unchanged.

The wait covers the revisions since the consumer last heard, up to the first revision recorded after the wait started (001-185). It holds for: the runner part of those revisions; every test file whose key they changed (added, edited, closure, declared inputs, observed paths), until each has a result under its new key (pass, fail, skip, or unknown with a reason); and a first-observation re-run of one of them. It does not hold for: slow files (as Stop), the baseline, backlog, `run --all`, other worktrees' work, 001-171's re-run (its failure is news), or edits made after the wait started. Only a transition of the edit's files ends it early; other checks' transitions are still printed. An environment change that re-keys every file holds for all of them (the human: keep it simple); the wait's timeout then says how many of the edit's files are still pending. The header keeps saying what else is pending. Read: `lessons.md` defect 32, D6, `src/cli/status-wait.ts`, 001-185's sync request. Own: `src/cli/status-wait.ts`, the daemon's sync request (additive), tests, D6, the skill's `commands.md`. Do not run `npm run build`. Done when: a neutral edit's wait returns within seconds of the edited file's result while a backlog runs; a slow file and another worktree's work do not hold it; an environment edit holds it, and its timeout names the pending count.

## 001-189 re-review of 001-170, 001-171 and 001-173 after 001-187 and 001-188

Use /reviewer on gpt-6.1-sol. Output `reviews/wave-13j.md`. Second round on `reviews/wave-13i.md`: are B1 to B4 closed and S1 to S3, N1 addressed, at the 0.1.78 landing. Re-run every probe of the first round, including B2's gated two-worktree ordering (the stopgap must keep B FAIL; 003-43's root fix is not yet landed). Range: from the 0.1.73 landing (f725736) to 0.1.78; 001-184 and 001-185 (0.1.76) are in range: judge only where they meet these rows. New meta rows `held-files:` and `reruns:` are per worktree; check they are pruned or bounded. Decided by the human: blockers go to the human.

## 001-190 `why` names a producer only when its run stored the state shown

Use /worker. Shape: fix. From `reviews/wave-13j.md` B4 (001-189). Decided by the human (2026-10-09): fix it, verified by the coordinator, no third review. After a forced run replaced a result with the same key and the same commit, `why` named the replacement run as producer of the earlier, unchanged inherited state, so `--include-logs` showed the wrong output. Outcome: a producer is named only when its run is the one that stored the state shown (match on the run identity the state was applied from, recording it with the known state if it is not there today, additively); otherwise `why` says no stored result is identifiably the one behind the state. Own: `src/core/status/`, `src/core/state/` (additive), tests under `test/status/`. Do not run `npm run build`. Done when: the reviewer's forced A PASS -> PASS probe is a regression (B's `why` keeps FIRST OUTPUT, or says none is identifiable), failing without the fix; 001-188's tests still pass.

## 001-191 `status --wait` keeps an earlier edit's files whose revision a hook already told

Use /worker. Shape: fix. 001-186's gap (`tasks/001-186/notes.md`): the window starts after the oldest revision told to the session, so two edits in separate tool calls, the first already told, drop the first edit's files, and the wait can end quiet while they are pending. Outcome: the window covers every revision since the consumer last saw a result (not merely a revision number) for the files it re-keyed; a told revision whose re-keyed files are all current is excluded, one whose files are still pending is kept. Read: D7 as amended, `src/cli/status-wait-edit.ts`, `Scheduler.rekeyedSince`, the consumer's told state in `src/core/delivery/`. Own: `src/cli/status-wait*.ts`, `src/core/delivery/` read-only helpers, tests, D7. Do not run `npm run build`. Done when: a test with edit A told, then edit B, holds the wait until both A's and B's files are done; a told revision whose files are all current does not hold it.

## 001-178 the idle waiter costs nothing while nothing changes

Use /worker. Shape: fix. The board row's evidence: an idle 0.1.62 waiter in cezar's main checkout used about 0.4 of a core for 14 minutes reading 30 MB/s from the store, because `waitForDelta` (`src/core/delivery/delivery.ts`) runs `deliver` every 250 ms and `deliver` lists every known state of the worktree (15,468). Outcome: each poll first reads a cheap change marker (SQLite `PRAGMA data_version`, or the latest revision plus a known-states change counter) and calls `deliver` only when it moved; a delivery that happens still produces exactly today's text. Own: `src/core/delivery/`, `src/harness/shared/waiter.ts`, tests under `test/delivery/` and `test/harness/`. Do not run `npm run build`. Done when: a test with 15,000 known states and no change counts store reads per idle minute (a handful, not one listing per poll); the existing waiter and delivery tests pass.

## 001-192 the reconciliation pass meets its budget, or the budget is measured

Use /worker. Shape: fix, measure first. The board row's evidence: `test/watcher/reconcile-pass.test.ts` (10,000 paths under 500 ms) fails at load 5 on main (585 to 690 ms), up from 526 to 541 ms earlier. Profile the pass on that test's fixture, compare with 0.1.62 (`git worktree add` at `squeal--v0.1.62`), and name what grew (004's ignored-input re-listing on every non-watch pass, 001-166's linked seeding, `candidatesForReconcile`, or the host's disk). Fix a regression; only if none, re-derive the budget from measurements here and on CI and say why. Own: `src/core/watcher/`, `src/core/keys/ignored-inputs.ts` and the interval re-listing in `keying.ts` only with the 002/003/004 coordinator's agreement (ask), the test. Do not run `npm run build`. Done when: the cause is named with numbers; the test passes 10 runs in a row at this host's idle load.

## 001-179 a timed-out backlog tier keeps its completed files and isolates the one that hangs

Use /worker. Shape: fix. The board row's evidence (004-46 re-dogfood, `004-slow-suites/lessons.md` defect 13): a 200-file cezarion baseline tier that reaches `runner.timeoutMs` (600 s) is re-run whole, and the next tier starts with the same 200 files, so the baseline never converges under load. Outcome: a timed-out tier stores the files that completed before the deadline (with D5's stability check and 001-168's completion barrier as for any run), re-queues the rest in smaller tiers (halving, down to one file), and a file that times out alone is `unknown` with "timed out after N s" instead of being retried forever; record it in D5/D12. Read: D5, D12, `src/core/scheduler/tiers.ts` (selection, recordTier), the runner's timeout path, `tasks/001-184/notes.md` (tier composition). Own: `src/core/scheduler/`, the Vitest adapter's timeout report if needed, tests under `test/scheduler/`, D5, D12. The 002/003/004 coordinator may be editing recordTier's growth settle (003-43's keyedAt): keep your recordTier change small and name the lines. Do not run `npm run build`. Done when: a test with one hanging file among many shows the others stored, the hanging file isolated and unknown with the reason, and the baseline finishing; an ordinary timeout of a one-file tier behaves as today.

## 001-194 a file's keyedAt is the earliest unresolved re-key, so no later edit hides it from a wait

Use /worker. Shape: fix. From the 002/003/004 lane's `003-node-test-runner/reviews/wave-4.md` (003-44, B1 and its note on 001-186's path): `revision.ts`'s settle overwrites `FileState.keyedAt`, so a wait that captured revision 1 loses its file when a later real edit at revision 3 re-keys the same file before the sync reads `rekeyedSince`, and the wait can end quiet while that file has no result. Outcome: `keyedAt` means the earliest revision whose re-key of the file has no result yet: a settle sets it only when it is null, and the file's next stored result (or unknown) clears it. That makes 003-45's growth rule (set only where null) the same rule everywhere. Read: D7 as amended, `tasks/001-186/notes.md`, `src/core/scheduler/` (files, ledger settle, revision.ts, refinement.ts, recordTier where results apply). Own: `src/core/scheduler/` for keyedAt only, tests under `test/scheduler/` and `test/cli/`, D7. 003-45 is editing recordTier's growth settle in tiers.ts; rebase onto it and leave that block alone. Do not run `npm run build`. Done when: a test syncs at revision 1, lands a later edit at revision 3 re-keying the same file, and the wait holds until that file has a result; a file whose result landed no longer holds any wait.

## 001-195 review of 0.1.83 to 001-194

Use /reviewer on gpt-6.1-sol, after 001-194 lands. Output `reviews/wave-13k.md`. Range: from the 0.1.82 landing to 001-194's, on the integrated candidate, on Node 22 and 24. Rows: 001-178 (idle waiter `changeMarker`), 001-181 (optimizer note, slow regression), 001-192 (reconciliation link probe), 001-174 (skill text), 001-191 (wait window keeps a told edit's files), 001-179 (timed-out tier split), 001-194 (`keyedAt`/`lastKeyedAt` as the earliest/latest unresolved re-key, cleared by a result or unknown). The 002/003/004 lane's 003-43/45 are in range: judge them only where they meet `keyedAt`.

Explicit questions, decided by the human (2026-10-09) as the check for 003-46: (1) `003-node-test-runner/reviews/wave-4.md` B1: a wait captured at revision 1, an unrelated revision 2, then environment growth: does the wait hold until the re-run's result? (2) `003-node-test-runner/reviews/wave-4.5.md` B1: the completed-sibling three-file case: does the wait captured at revision 2 hold for every file still without a result? Also: can any re-key path leave a file's `keyedAt` stale, or clear it before its result; can `squeal status --wait` still end quiet while a file an edit re-keyed has no result; is the idle waiter's change marker ever stale after a commit by another connection. Decided by the human: blockers go to the human.

## 001-196 `status --wait` compares keys, keeps its own news, and the skill reads the result

Use /worker. Shape: repair. From `reviews/wave-13k.md` (001-195) B1, S1, N1. Decided by the human (2026-10-09): repair, then a re-review (001-197). B1: `unseenRevisions` treats `observedAt === keyedAt` as complete, but a sibling re-keyed by growth in the same revision has a result only for its previous key; decide "seen" by a result under the file's current key, not by revision. S1: `applyResults` clears attribution before the sync answer reads `rekeyedSince`, so a result that lands between the wait's start and that answer loses the edit's own news (quiet instead of news); keep the membership captured for an active wait through its answer without reviving discharged attributions (do not restore every historical `keyedAt`, which reopens 003 wave-4.5 B1). Skill: the red/green example in both plugins' `SKILL.md` must read the result shown or the known failures, not infer a pass from quiet. N1: the D5 and D7 amendment lines in `status.md`. Read: `reviews/wave-13k.md` (its probes), `tasks/001-186`, `001-191`, `001-194` notes, D7. Own: `src/cli/status-wait*.ts`, `src/core/scheduler/` for attribution only, `src/core/daemon/` sync answer, both skills, `status.md`, tests. Do not run `npm run build`. Done when: both probes are real-scheduler regressions on Node 22 and 24, failing without the fix; 003's two B1 regressions still pass; the skill test pins the new wording.

## 001-197 re-review of 001-196

Use /reviewer on gpt-6.1-sol, after 001-196 lands. Output `reviews/wave-13l.md`. Second round on `reviews/wave-13k.md`: are B1 and S1 closed, the skill correct, N1 done, on Node 22 and 24; re-run both 003 B1 regressions. Decided by the human: blockers go to the human.

## 001-199 a check's key names its key format, not the Squeal release

Use /worker. Shape: slice. Decided by the human (2026-10-10): every hub release re-ran every worktree's full suite (cezar: 15,468 checks pending at once), because `src/core/keys/environment.ts` puts the daemon's Squeal version into every environment hash (spec 001 D3; 004-17 dogfooding defect 4).

Outcome: the environment hash carries a `KEY_FORMAT_VERSION` constant (a small integer in `src/core/keys/`) in place of the Squeal version; each runner adapter's `adapterVersion` stays in it as today. A test fails whenever the code that builds keys or results changes without a bump: a hash of the key-relevant sources (`src/core/keys/**`, `src/core/hash/**`, the runners' result and closure code, chosen and listed in the test) pinned beside `KEY_FORMAT_VERSION`, so a change to them makes the test say "bump KEY_FORMAT_VERSION and update this hash". The first value keeps today's keys valid only if that is provably safe; otherwise the switch itself re-keys once. The daemon version still decides step-down (D10) and stays in status. D3 and D4 say what the key now names and when to bump.

Read: D3, D4, D10, `src/core/keys/environment.ts`, `src/core/daemon/version.ts`, each adapter's `adapterVersion`, `research/release-hub.md` (the environment-hash note). Own: `src/core/keys/`, the adapters' version constants only, tests under `test/keys/`, D3, D4, `docs/process.md` only to add one line to step 6a (the release checklist: bump `KEY_FORMAT_VERSION` when the guard test asks; the human owns the file, so put the line in your report for the coordinator to propose). Do not run `npm run build`.

Done when: two builds that differ only in `package.json` version give the same key for every check; changing a key-relevant source without a bump fails the guard test; an adapter version bump still re-keys that runner's checks.

## 001-200 review of 001-199

Use /reviewer on gpt-6.1-sol, after 001-199 lands. Output `reviews/wave-13m.md`. Can a release now keep a result whose meaning changed: list every input to a result's outcome that is not in the key (Squeal's own code paths: transforms, stamps, the recorder, reporters) and check the guard test covers it; is the step-down unaffected. Decided by the human: blockers go to the human.

## 001-202 a later discharge never erases an earlier wait's own news

Use /worker. Shape: fix. From `reviews/wave-13l.md` (001-197, PASS) S1: `discharges.ts` keeps only the last discharge per file, so a later cache-hit result beyond the wait's captured revision overwrites an earlier one before the sync answers, and the wait reports quiet with the edit's news counted as another check's. Outcome: discharges are kept per (file, revision) for as long as any wait could still ask (bounded by the wait's longest timeout or a cap), and `rekeyedSince(..., resolvedSince)` names every discharge inside the window. Read: `reviews/wave-13l.md` (its exact sequence and control), `tasks/001-196/notes.md`, D7. Own: `src/core/scheduler/discharges.ts` and its callers, tests. Do not run `npm run build`. Done when: the reviewer's sequence is a regression on Node 22 and 24, failing without the fix; memory stays bounded under a long session.

## 001-203 the key-format guard covers everything that can affect a stored result, minus an explicit exempt list

Use /worker. Shape: repair. From `reviews/wave-13m.md` (001-200) B1, S1, S2. Decided by the human (2026-10-10): invert the guard, then a re-review (001-204).

Outcome: `test/keys/key-format.test.ts` hashes all of `src/` and the build inputs (`src/harness/build.ts` and whatever decides which runtime files ship) plus a version-independent fingerprint of the plugin's bundled runtime dependencies (`package-lock.json` entries of the packages the build embeds, not the root version), minus a short, named exempt list of paths that cannot affect what is stored or accepted (CLI wording, delivery and status formatting, hook entry text, skills, docs). Every exemption carries a one-line reason in the test. The adapter version constants move to small files of their own that the guard exempts, so an adapter-only bump moves only that runner's keys (S1). Forgetting an exemption costs a re-key, never a false pass.

Read: `reviews/wave-13m.md` (B1's probe, the "Inputs to a result that the key does not directly name" inventory, S1, S2), `src/core/keys/key-format.ts`, D3, D4, `docs/process.md` 6a. Own: `test/keys/`, `src/core/keys/key-format.ts`, the adapters' version constants (new files), D3, D4. Re-pin `KEY_FORMAT_VERSION` 1's hash in place (still unreleased). Do not run `npm run build`.

Done when: the reviewer's barrier mutation (and one in `recordsForFile`) fails the guard; a change to an exempt file does not; a version-only `package.json` change does not; a bundled dependency's lock entry change does; an adapter-only bump keeps the global pin and moves only that runner's keys.

## 001-204 re-review of the key-format guard

Use /reviewer on gpt-6.1-sol, after 001-203 lands. Output `reviews/wave-13n.md`. Second round on `reviews/wave-13m.md`: are B1, S1, S2 closed; is each exemption truly unable to change what is stored or accepted. Decided by the human: blockers go to the human.

## 001-205 worktrees split a baseline through derived claims

Use /worker. Shape: slice. From `research/shared-runs.md` (001-201), decided by the human (2026-10-10). Build the recommendation as written there: a claim is another live worktree's `test_file_keys` row at the key with `pending = 'running'` and a fresh heartbeat (no table, no migration); the check and claim inside `startTier`'s `BEGIN IMMEDIATE`; the gate (only a file whose lookup would accept another worktree's result waits: not forced, not `recent`, `Ledger.inherits`, not an unconfirmed fail), in `selectTier` and the slow tier's `#pick`; the wake on `changeMarker` and at least once a second; expiry by record, two stale heartbeat intervals, or `runner.timeoutMs` plus 6 s; the two fixes (a starting daemon resets its leftover `running` rows before its first heartbeat; `running` only while `file.key === file.runningKey`); the backlog cap (remaining queued files divided by live daemons, floor `runner.tierSize`, ceiling `runner.backlogTierSize`). Amend D5, D8, D10 and 004 D6 as the research words them (004 D6 by agreement with the 002/003/004 coordinator; tell me the line).

Own: `src/core/scheduler/`, `src/core/store/` (queries only, no schema change), `src/core/daemon/` start, the slow tier's `#pick` (ask the 002/003/004 coordinator first), tests under `test/scheduler/` and `test/daemon/`. 001-203 is changing `test/keys/` and the adapters' version constants; the key-format guard will ask for a re-pin of version 1 after this lands (still unreleased). Do not run `npm run build`.

Done when: the research's ten tests pass over two schedulers on one real store; a four-worktree probe like its finding 5 shows each key run once.

## 001-206 review of shared runs

Use /reviewer on gpt-6.1-sol, after 001-205 lands. Output `reviews/wave-13o.md`. Can a claim ever leave a file unrun, run it twice, delay an edit's own file, or let a result stand that 004 D6 or 001-170 forbid; does a crashed, stepped-down or restarted daemon release its claims. Decided by the human: blockers go to the human.

The 002/003/004 coordinator's conditions on the slow tier's `#pick` (`src/core/state/slow-tier.ts`), each an explicit question: (a) no hot spin: does a queue holding only claimed slow files make `next()` return null, and does a claim's end (a result, the claimant dying or cancelling) wake the pump through an event so the file then runs here, with a test for each; (b) is there no second slot release and no `#publish` when `startTier` returns null; (c) does the 004-29 drain end when the claimed key's result lands.

## 001-210 repair of shared runs

Use /worker. Shape: repair. From `reviews/wave-13o.md` (001-206) B1, B2, S1, N1. Decided by the human (2026-10-10): fix, then a re-review (001-211).

Outcome: B1: inside `startTier`'s `BEGIN IMMEDIATE`, before the claim check, each picked file that is not forced is probed again (`ledger.probe`), exactly as `selectTier` does: an acceptable result settles the file there (applied, checkpoint attribution finished) and drops it from the tier; a withheld hit runs here rather than waiting. The ledger's changes are committed even when no tier remains. Forced runs, recent (edit) files, 004 D6 and 001-170 keep their current behaviour. The slow tier shares this path. B2: after `startTier` returns a tier, the slow tier shrinks its slot to `tier.files.length`, and its per-file notes, published paths and artifact records follow `tier.files`; the null path keeps its one release and no running activity. S1: a slow waiter test whose claimant cancels without an acceptable result, woken by the claim wake (no watch batch, no full-suite request, no tight slot loop). N1: dated amendment entries for 001-205 (D5, D8, D10, the sharer divisor) in this spec's `status.md`, and for 004 D6 in `../004-slow-suites/status.md`.

Read: `reviews/wave-13o.md` (both probes), `research/shared-runs.md`, `src/core/scheduler/tiers.ts`, `src/core/scheduler/claims.ts`, `src/core/state/slow-tier.ts`, D5, D8, 004 D2, D6. Own: `src/core/scheduler/`, the slow tier's `#select`/`#pick` (`src/core/state/slow-tier.ts`), tests under `test/scheduler/`, the two `status.md` amendment entries. Keep 250 ms store polling, one second between dead-claim rechecks, two heartbeat intervals of grace, the waiter bound, the starvation rule, the lane cap and the force/recent exceptions. The key-format guard will ask for a re-pin of version 1 (still unreleased); the coordinator does it. Do not run `npm run build`.

Done when: a deterministic finished-tier race beside research test 9 (A records K between B's selection and start) runs K once, including a case where every selected file settles and no run row opens; a shared-slot test with a third owner shows it gets the spare permit while B's survivor runs; the S1 cancellation test passes; removing each fix turns its test red; lint, typecheck and the full suite are green.

## 001-211 re-review of shared runs

Use /reviewer on gpt-6.1-sol, after 001-210 lands. Output `reviews/wave-13p.md`. Second round on `reviews/wave-13o.md`: are B1, B2, S1, N1 closed; does the in-transaction re-probe keep every gate (forced, recent, 004 D6, 001-170) and settle without a run row. Decided by the human: blockers go to the human.

## 001-213 review of the per-revision discharges

Use /reviewer on gpt-6.1-sol. Output `reviews/wave-13q.md`. Range: `b7c0206a^..f8f99207` (001-202 and its 0.1.90 rebuild), read on today's main, since later rows (001-205, 001-210) changed the scheduler around it. Is `reviews/wave-13l.md` S1 closed: can a later discharge still erase an earlier wait's own news; do the 1 h and 10,000-entry bounds ever drop a discharge a live wait still needs; does anything since 0.1.90 break it. Decided by the human (2026-10-10): reviewed before the 0.1.94 hub release; blockers go to the human.

## Wave 13r (after the 0.1.94 hub release)

Four workers, disjoint ownership, then one review (001-215). Each: Do not edit `docs/board.md`. Do not run `npm run build`. The key-format guard will ask the coordinator for a bump of `KEY_FORMAT_VERSION` to 2 (version 1 shipped in 0.1.94) if a row changes a guarded source; the coordinator does it at landing.

## 001-207 a store opening beside concurrent openers never fails on `database is locked`

Use /worker. Shape: defect. From the 0.1.92 gate: `test/store/concurrency.test.ts` "4 writers and 4 readers lose no updates" failed when a child exited before ready, `PRAGMA journal_mode = WAL` at `src/core/store/open.ts:86` throwing `database is locked` though `busy_timeout` is set (load ~47; passed alone 3 of 3). Find the holder or path first (SQLite skips the busy handler on some lock upgrades; the `auto_vacuum` line before it also writes), then fix with the least change: a bounded retry of the open's writes, or doing them under one `BEGIN IMMEDIATE`, keeping 001-141 (opening writes nothing on an existing file) and 001-161 (a starting daemon waits 120 s, 5 s once ready).

Own: `src/core/store/open.ts`, `test/store/`. Done when: the cause is named in the notes; a repeated test of 8 processes opening one new store at once (and one existing store) opens every time, red without the fix; lint, typecheck and the full suite are green.

## 001-208 and 001-209 two test fixes

Use /worker. Shape: defect (test-only). 001-208: `test/daemon/scratch.test.ts:108` reads `/proc/<pid>/cwd` outside the `waitFor` above it, so under load it saw `<repo>/linked` before the daemon moved to `<common-dir>/squeal` (Node 22, load ~30; 9 of 9 alone): wait for the move. 001-209 (`reviews/wave-13n.md` S3): `test/keys/key-sources.ts:187` skips `src/cli/daemon.ts`, the dispatcher and the three build modules when scanning imports: scan them too, allowlist the dispatcher's present command edges by name with a one-line reason each, and add a regression that a new daemon- or build-to-exempt import fails.

Own: `test/daemon/scratch.test.ts`, `test/keys/`. Done when: the scratch test passes 20 times in a row beside a CPU load (say `--maxWorkers` saturated or a busy loop per core); 001-209's regression fails on an injected edge and passes without it; the guard's pin is unchanged (test files are not guarded); lint, typecheck and the full suite are green.

## 001-212 a stopped-process note says enough to find the test that left it

Use /worker. Shape: slice. From the human (2026-10-10): a note like `stopped 1 process a test left running after its tier: 1591510 claude auth status --json` names only a pid and command line, both gone when read. Each stopped process's entry adds its parent's command line (read at the scan, before signalling), its age when stopped, and whether it needed SIGKILL after the grace; the note names the tier's run ID, and `squeal why`/the run's log reaches that run's test files. Keep the note one line per stop, the 120-character command cap, and the pid-and-start-time identity check before every signal (review 001-149 S2).

Own: `src/core/daemon/escaped.ts`, where the note is recorded and shown (`afterEachRun`'s caller, the status note formatter), tests under `test/daemon/`. Done when: a test whose fixture leaves a child running (one that exits on SIGTERM, one that ignores it) gets a note with all four facts, and the run ID leads to its test file; lint, typecheck and the full suite are green.

## 001-214 a discharge a live wait still needs is never evicted

Use /worker. Shape: defect. From `reviews/wave-13q.md` S1 (read its probe table): `src/core/scheduler/discharges.ts:80` drops the oldest entry past 10,000 entries or one hour even when an outstanding captured `status --wait` answer still needs it, and the wait then reports quiet where its own file's news landed. Keep entries a live captured answer needs (for example, the prune skips entries at or after the oldest outstanding answer's captured revision, with that answer's own end or expiry as the bound), while entries no live answer needs are still pruned by the same limits; memory stays bounded when no wait is outstanding.

Own: `src/core/scheduler/discharges.ts`, the wait's sync path in `src/core/scheduler/scheduler.ts` only where it registers or ends an answer, `test/scheduler/`. Done when: the review's probe at both bounds keeps the wait's news (red before); a test shows unneeded entries still pruned at both bounds; lint, typecheck and the full suite are green.

## 001-215 review of wave 13r

Use /reviewer on gpt-6.1-sol, after 001-207, 001-208/209, 001-212 and 001-214 land. Output `reviews/wave-13r.md`. Is each row's done-when met; does 001-207 keep 001-141 and 001-161; does 001-212's note ever signal or name a process that is not the test's; can 001-214's retention grow without bound. Blockers go to the human.

## 001-226 repair of wave 13r

Use /worker. Shape: repair. From `reviews/wave-13r.md` (001-215) B1, B2, S1, N1; decided by the human (2026-10-10): B2 bounded, then a re-review (001-227). Read the review's reproductions first.

Outcome: B1: a stop's entries carry their attribution. A lane-marked carrier names its own run. A bare-marker carrier or an unmarked group orphan, stopped at the end of an overlapping interval, names every run that overlapped that interval and says the attribution is uncertain (for example `(one of runs a, b)`); each named run's record lists its test files. Lane isolation and every identity check stay as they are. B2, bounded (no protocol change): a sync request's hold is released when `remember` drops the request from the 32-entry map, and after 1 h at the latest (one constant), idempotently and even while refinement is blocked; an answer whose hold was released before it was read reports incomplete (the CLI's existing fallback for an unsupported sync, or a distinct state if the wait needs one), never quiet. At most 32 holds can exist. S1: `test/store/opening.test.ts` keeps the deterministic 500 ms write-lock case as the default discriminator, and replaces the 100-round spinning stress with a small concurrent create/reopen smoke test that uses a blocking rendezvous, gives its barrier a deadline, and kills and awaits every child on every exit. N1: D12 describes the note's parent, age, signal and run attribution; D7 the held answer's lifetime and `Scheduler.rekeyedOnceRefined`; dated entries for 001-212 and 001-214 (and this repair) in `status.md`.

Own: `src/core/daemon/escaped.ts`, `src/core/daemon/terminate.ts`, `src/core/daemon/handlers.ts` (the sync map and `remember`), `src/core/scheduler/discharges.ts`, `src/core/scheduler/scheduler.ts` (`rekeyedOnceRefined`), `src/cli/status-wait.ts` only for the incomplete answer, tests under `test/daemon/`, `test/scheduler/`, `test/store/opening.test.ts` and its child helpers, D7, D12 and `status.md`. The key-format guard will ask for a re-pin of version 2 (unreleased); the coordinator does it. Do not run `npm run build`.

Done when: B1's overlap probe (a short run's bare-marker child, a disjoint long run) and an unmarked-orphan case name both candidate runs, red before; B2's probe (refinement suspended, 40 real sync requests) holds at most 32 at once and none past the deadline (time simulated), with entries pruned back once released, red before; a request evicted mid-wait gives an incomplete answer, not quiet; the opening test's deterministic case still fails without 001-207's retry; lint, typecheck and the full suite are green.

## 001-227 re-review of wave 13r

Use /reviewer on gpt-6.1-sol, after 001-226 lands. Output `reviews/wave-13s.md`. Second round on `reviews/wave-13r.md`: are B1, B2 (as the human bounded it, not full cancellation), S1 and N1 closed; can a hold still outlive its request or its deadline; can an incomplete answer ever read as quiet. Run your own independent full suite. Blockers go to the human.

## 001-229 a held answer's hour ends on time while refinement stalls

Use /worker. Shape: repair. From `reviews/wave-13s.md` (001-227) B2, decided by the human (2026-10-10): fix, then a third review (001-230). Read the review's reproduction and fix paragraph first.

Outcome: a hold's `HOLD_MS` deadline is enforced by an independent timer (one for the earliest deadline, re-armed) or a bounded periodic sweep that runs while refinement is blocked. When expiry wins, the hold is released, the history it alone protected is pruned (by the expiry time, not only `#latest`'s discharge time, so age-only excess goes too), and the pending answer rejects `INCOMPLETE_ANSWER`. Expiry, forget and a normal answer are idempotent against each other; every end path clears its timer and listeners; a timer never keeps the daemon alive (`unref`). The socket and the CLI are unchanged.

Own: `src/core/scheduler/discharges.ts`, the held-answer path in `src/core/scheduler/scheduler.ts`, `src/core/daemon/sync-requests.ts` only if it must own the timer, and their tests under `test/scheduler/` and `test/daemon/`. The key-format guard will ask for a re-pin of version 2 (unreleased); the coordinator does it. Do not run `npm run build`.

Done when: the review's regression passes and is red before: stall the real refinement, exceed both age and count bounds, advance timers past one hour with no discharge, hold or read, and see zero expired holds, pruned unprotected history and an incomplete error on each retained request, while a younger hold's membership stays intact; expiry raced against forget and against a normal answer, in both orders, gives no double release and no unhandled rejection; the 40-request eviction test and the overflow and hour controls still pass; lint, typecheck and the full suite are green.

## 001-230 third review of wave 13r

Use /reviewer on gpt-6.1-sol, after 001-229 lands. Output `reviews/wave-13t.md`. Third round on `reviews/wave-13s.md` B2 only: does a hold now end at its deadline while refinement stalls; can expiry, forget and a normal answer ever double-release or leave a rejection unhandled; does any timer keep a daemon alive. Run your own independent full suite. Blockers go to the human.

## Wave 13u (after the 0.1.99 hub release)

Five workers, disjoint ownership, then one review (001-233). The rows come from the human's cezar test session (via the 005 coordinator), 005's header proposals the human decided, and two review notes. Each: Do not edit `docs/board.md`. Do not run `npm run build`. `KEY_FORMAT_VERSION` 2 shipped in 0.1.99, so a change to a guarded source asks the coordinator for a bump to 3 at landing; the coordinator does it once for the wave. CI on main is read before every landing: a test that runs `git commit` sets its own identity, and no test may depend on this host's timing or caches.

## 001-220, 001-221, 001-222 (known failures), 001-223, 001-224: what a delivery says

Use /worker. Shape: slice. Read each row on the board first.
- 001-220 (decided by the human): a PASS -> UNKNOWN whose only cause is the consumer's own edit landing during the file's run (the 001-146 stamps) is not delivered. Any other cause of UNKNOWN still is. The silenced state is never recorded as delivered, so the next delivery compares against PASS.
- 001-221: the delivered summary of an assertion failure keeps the first lines of Vitest's diff (expected vs received), within the existing size cap, so a truncated `…(1)` object never hides the field that differs.
- 001-222, the delivery half: `Known failures: N` names them, or the first few and then `squeal status`.
- 001-223 (005 proposal a): once every test file the consumer's edits re-keyed is current, the next delivered header says so once (the set 001-186 computes). No line while any is pending.
- 001-224 (005 proposal c, decided by the human): once per consumer session, the first delivery after its first edit says, in one line, "Squeal saw your edit and queued N test files; results arrive with later tool calls, and passing ones stay silent." It never repeats in that session, and a session that never edits gets none.

Own: `src/core/delivery/`, the hook text module `src/harness/shared/text.ts` (and the Known failures call sites in `src/harness/shared/stop.ts`), `describeFailure` in `src/core/state/fingerprint.ts` (the fingerprint itself unchanged; agreed 2026-10-10), the Vitest adapter's failure-message extraction (`src/runners/vitest/` reporter or summary code only), tests under `test/delivery/`, `test/harness/` and the adapter's tests. Done when: each row's done-when on the board holds in a test; lint, typecheck and the full suite are green.

## 001-217, 001-219, 001-222 (notes): checkpoints in status and across a session's end

Use /worker. Shape: slice.
- 001-217: status names a checkpoint in progress (its kind, its start, and files done of total) and counts files running that have no checks yet. `status --wait`'s quiet line names a running checkpoint and points to `run --all --wait` (005 proposal b). A `run --all` while an equivalent checkpoint runs joins it rather than abandoning it.
- 001-219: an explicit checkpoint either finishes before the idle exit (bounded, like 004-29's drain) or resumes in the next daemon. A first-seen failure's 001-171 re-run happens before exit or is owed by the next daemon.
- 001-222, the status half: status groups stopped-process notes by command, with counts, keeping 001-212's per-process detail reachable (for example `squeal status --notes`).

Own: `src/core/status/format-status.ts`, `src/core/status/snapshot.ts`, the checkpoint code in `src/core/scheduler/` (`checkpoint*`, the 001-171 re-run's owed state), the daemon's idle exit in `src/core/daemon/lifecycle.ts`, `src/cli/run.ts`, `src/cli/status-wait-lines.ts`, tests under `test/status/`, `test/scheduler/`, `test/daemon/`, `test/cli/`. Done when: each row's done-when on the board holds in a test, including a session ending mid-checkpoint and the checkpoint completing; lint, typecheck and the full suite are green.

## 001-216 an atomic save's temp file never becomes a revision of its own

Use /worker. Shape: defect. Read row 001-216: Claude Code's `<file>.tmp.<pid>.<random>` landed alone in revisions when create and rename fell ~550 ms apart, in separate 100 ms batches. Find the least change that keeps D2's promise ("an atomic save's temp file is never known") across batches. For example, a create whose path is gone by the time its batch is hashed, or that matches the atomic-save shape and is renamed within a bounded window, yields no revision. A real add must not be delayed past that window.

Own: `src/core/watcher/`, tests under `test/watcher/`. Done when: a save whose create and rename land in different batches, at load, makes exactly one revision naming the real file; a real file added alone still makes its revision within the bound; lint, typecheck and the full suite are green.

## 001-228 and 001-232: two scheduler timers

Use /worker. Shape: defect.
- 001-228 (`reviews/wave-13r.md` B2): a runner-part call (`invalidate`/`affected`) has no maximum duration, so one that stalls holds every `status --wait` to its own timeout and delays the revision's results. Bound it: past the bound it is abandoned with a note and the revision proceeds (or the runner restarts), with the bound named in D5.
- 001-232 (`reviews/wave-13t.md` S1): after a runtime pause, the hold-expiry callback sweeps at its scheduled time and re-arms from it, so a younger overdue hold waits another delay. Sweep at the real now and re-arm from it.

Own: the runner-work code in `src/core/scheduler/` (`runner-work*`, the runner-part call sites), `src/core/scheduler/discharges.ts`, tests under `test/scheduler/`, D5. Done when: a test stalls a runner part and the next revision's results land past the bound; a simulated pause releases every overdue hold in one callback; lint, typecheck and the full suite are green.

## 001-225 `squeal why` names what changed since an older result's revision

Use /worker. Shape: slice. Read row 001-225 (005 D6, decided by the human). When a check's result ran at a revision older than the current one, `squeal why` adds `Changed since revision 8: src/a.ts (revision 9), src/b.ts (revisions 10, 12)`, built from the stored revision records, capped like the other `why` lists. The result's own line names its revision (the 005 coordinator agreed). The primer sentence defining a revision is 005-15's, not this row's.

Own: `src/core/status/why.ts`, `src/core/status/format-why.ts`, the store queries they need (no schema change), tests under `test/status/`. Done when: the line appears exactly when the result's revision is older, lists each changed path with its revisions, is capped, and is absent for a current-revision result; lint, typecheck and the full suite are green.

## 001-233 review of wave 13u

Use /reviewer on gpt-6.1-sol, after the five land. Output `reviews/wave-13u.md`. Is each row's done-when met? Does 001-220 ever silence an UNKNOWN with another cause, or lose a later PASS -> FAIL? Can a joined or resumed checkpoint run a file twice or never? Can 001-216 delay or drop a real add? Does 001-228's bound ever abandon a runner part that would have finished, and what does a revision do then? Run your own independent full suite. Blockers go to the human.

## 001-238 repair of wave 13u's edit lines

Use /worker. Shape: repair. From `reviews/wave-13u.md` (001-233) B1, B2, S1, S2; decided by the human (2026-10-10): fix, then a re-review (001-239). Read the review's reproductions first.

Outcome: B1: 001-223's settled line and 001-224's queued count come from the daemon's own record of the files a consumer's edits re-keyed (the 001-186 set that `status --wait` uses), not from comparing a key snapshot. The daemon persists, per worktree, what delivery needs (for example, per file, the earliest unresolved re-key revision and whether it is resolved) in a meta row or rows written in the transaction that re-keys and resolves; delivery reads it in its own transaction. No schema change. A first-listed file that a source edit affects counts; a changed-then-reverted file still pending counts until it has a result; an untouched backlog file never counts. Drop the per-consumer key snapshot unless it is still needed, and if it is, bound it. Keep Stop's silence and the 223/224 merge. B2: a once-told marker for a consumer identity outlives unregister for the parked-registration lifetime and is restored on resume; a new session ID gets its own line; the marker shares the parked registration's cleanup. S1: worktree removal (`src/core/store/repos/worktrees.ts`) prunes the new meta rows (`edit-keys:…`, `edits:<worktreeId>`, `checkpoint.<worktreeId>`, and the 001-238 rows), by explicit ownership parsing or a prefix registry, never a loose suffix match. S2: `test/cli/status-wait.test.ts:391` passes `env: {}` or asserts the chosen command.

Own: `src/core/delivery/`, the scheduler's re-key and resolve paths where they write the new rows (`src/core/scheduler/ledger.ts`, `rekeyed*`), `src/core/store/repos/worktrees.ts` for the prune, tests under `test/delivery/`, `test/scheduler/`, `test/store/`, `test/cli/status-wait.test.ts`, `test/e2e/`. The coordinator re-pins `KEY_FORMAT_VERSION` 3 and rebuilds. Run `npm run build` locally for the e2e suite, but do not commit `dist`.

Done when: the review's two B1 regressions pass through delivery, red before, at least one through the scheduler's actual re-key set; the B2 tests (unregister then resume, expiry then resume within the parked lifetime, a new session ID) pass; a worktree removal leaves none of the new rows; the CLI test passes with and without `CODEX_SESSION_ID`; `test/e2e/transitions.test.ts` passes; lint, typecheck and the full suite are green with `GIT_CONFIG_GLOBAL=/dev/null`.

## 001-239 re-review of wave 13u

Use /reviewer on gpt-6.1-sol, after 001-238 lands. Output `reviews/wave-13v.md`. Second round on `reviews/wave-13u.md`: are B1, B2, S1 and S2 closed; can the settled line still appear while an edit's file is pending; is the daemon-written attribution consistent with `status --wait`'s; is every new meta row bounded and pruned. Run your own independent full suite with `GIT_CONFIG_GLOBAL=/dev/null` and without `CODEX_SESSION_ID`. Blockers go to the human.
