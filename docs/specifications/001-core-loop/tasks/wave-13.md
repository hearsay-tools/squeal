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
