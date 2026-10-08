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
