# Wave 12 briefs

From `lessons.md` defect 24 and the human's decision of 2026-10-08. Standing models per the board. 001-121 (research) runs first; 001-122 builds on its findings; 001-123 reviews.

## 001-121 research: which process is the harness, seen from a hook

Use /researcher. Topic: `research/README.md` "harness-process-liveness". Output `research/harness-process-liveness.md`, probes under `research/probes/harness-process-liveness/` (throwaway). Never touch this repository's store or daemons you did not start.

Outcome: a rule a hook can apply to name the long-lived harness process (Claude Code interactive and `-p`, a subagent's hooks, Codex), plus a way for the daemon to tell later that exactly that process is gone, safe against PID reuse.

Done when every question in the topic has a tagged answer or "not determined, because", and the recommendation names the rule and its cost per hook (it runs on SessionStart, UserPromptSubmit, PostToolBatch and Stop at least).

## 001-122 a daemon exits when its last session is gone

Use /worker. Shape: slice. After 001-121.

Outcome: when no session is registered (the last one unregistered, or its harness process died), the daemon finishes the tier it is running, persists one note, and exits; a new session within 3 s keeps it alive.

Read: `lessons.md` defect 24; `research/harness-process-liveness.md`; spec D9 (SessionStart, SessionEnd, registration), D10 (exit conditions, consumer expiry, waiter-lock liveness); `src/core/daemon/lifecycle.ts`, `src/core/delivery/` (consumers, expiry), `src/harness/shared/` (registration).

Decided by the human: no idle period after the last consumer leaves; a 3 s grace absorbs `/clear` and `/resume`; a tier already running finishes and its results are stored, then the daemon exits; a consumer whose recorded harness process is gone is unregistered on the daemon's next heartbeat, not after 12 hours. Keep: `daemon.idleExitMinutes` for a daemon that never had a consumer (started by `squeal start`); the 12 h expiry as a backstop for a consumer with no recorded process (older clients); the waiter-lock rule for interactive sessions.

Research result (001-121, `research/harness-process-liveness.md`): under Claude Code take `CLAUDE_PID`; otherwise walk up from the hook's parent past shells to the first non-shell process; record `(pid, /proc/<pid>/stat start time, pid namespace)`; gone when the stat file is missing, the start time differs, or the state is `Z`; about 30 µs per hook. One process can host several sessions (`/clear`, Codex `app-server`): a dead process removes all its sessions, a live one proves nothing about a given session (keep SessionEnd and the existing expiry for that). macOS: no µs start time from Node; use `ps -o lstart` once per registration only, or fall back to the 12 h expiry, and say which.

Seam: record the harness process identity (per 001-121's rule) with each registration in `src/harness/shared/`, in the consumer record (additive, through `meta` or an additive column; ask before a schema change), then the exit decision in `src/core/daemon/lifecycle.ts`.

Own: `src/core/daemon/lifecycle.ts` and the exit path (not `node-test-runners.ts` or the runner construction in `daemon.ts`, which the 002/003 coordinator owns), `src/core/delivery/` (consumers, expiry), `src/harness/shared/` (registration only; ask before `src/harness/codex/`), `src/core/types/` (additive), the e2e fixture teardown that leaked a daemon (`test/e2e/` helpers: unregister and remove the fixture), tests under `test/daemon/`, `test/delivery/`, `test/harness/`, D9 and D10 in `spec.md`, one `status.md` line. Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: a real daemon with one registered session exits within 3 s of that session's SessionEnd when idle; with a tier running, it exits right after the tier's results are stored; a SessionStart within the grace keeps it; a session whose harness process is killed (SIGKILL, no SessionEnd) is dropped and the daemon exits within one heartbeat interval plus the grace; a PID reused by another process does not count as the session; `squeal start` with no session keeps today's idle timeout; the e2e suite leaves no daemon running after it ends.

## 001-123 review of 001-122

Use /reviewer. Range: 001-122's commits as landed. Output `reviews/wave-12.md`. Outcome: can a daemon now exit while a session still needs it, or still outlive every session. Probe: a subagent's SessionEnd while the main agent stays; two sessions on one worktree; `/clear` and `/resume`; a long tier when the last session leaves; SIGKILL of the harness in interactive and `-p` mode, both plugins; a PID reused within the heartbeat interval; Cezar destroying a worker mid-tier.

## After 001-122

001-122 landed as 0.1.32 (`dbeb862`). Four rows from defects 25 to 28, decided by the human (2026-10-08). 001-124, 001-126 and 001-127 run in parallel; 001-125 waits for nothing but uses 001-122's exit path.

## 001-124 backlog work runs in machine-wide tiers

Use /worker. Shape: slice. Defect 25. Outcome: a backlog (baseline, environment change, `run --all`, carried work) runs about as fast as the project's own Vitest run, and an edit's tests still start within one small tier.

Read: `lessons.md` "A backlog runs thirty times slower than the suite"; spec D5 (tiers, ordering, recent first, the starvation bound), D4 (`run`); `src/core/scheduler/tiers.ts`, `queue.ts`, `runner-work.ts`; `src/runners/vitest/run.ts`.

Decided: edit-caused work runs in tiers of `runner.tierSize` (default 4) as today. When the queue holds only backlog work, a tier takes up to `runner.backlogTierSize` files (new key, default: every queued backlog file, capped so one tier stays under a few minutes; say the cap). When edit-caused work arrives during a backlog tier, the backlog tier is cancelled (Vitest's cancel), the files that completed keep their results under the D5 stability check, the rest go back to the queue, and the edit's tier runs next. Keep the starvation bound.

Own: `src/core/scheduler/` (tiers, queue, runner-work), `src/runners/vitest/run.ts` (cancel and partial results), `src/core/types/policy.ts` and `src/core/daemon/policy.ts` (the new key), tests under `test/scheduler/`, `test/runners/vitest/`, D5 and D11 in `spec.md`, `plugins/claude-code/skills/squeal/references/policy.md` (the key), one `status.md` line. Leave `src/core/daemon/lifecycle.ts` (001-125), `src/core/status/` (001-126). Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: on a 200-file fixture a backlog of all files runs in at most a few tiers and within 2x the direct `vitest run` time (measured); an edit during a backlog tier cancels it and its tests start within one small tier, with the completed files' results kept; the existing ordering, recent-first and starvation tests pass.

## 001-125 a daemon older than its hooks steps down

Use /worker. Shape: slice. Defect 26. Outcome: a hook whose Squeal version is newer than the running daemon's makes that daemon finish its tier and exit, and the hook's own ensure path starts a current one.

Read: `lessons.md` defect 26; spec D10 (ensure, exit, 001-122's exit after the running tier), D9; `src/harness/shared/ensure.ts`, `src/core/daemon/lifecycle.ts`, `src/core/daemon/server.ts` (the socket's requests). Decided: compare the hook's bundled version with `worktrees.daemon_version` (semver); only a strictly older daemon steps down; a newer daemon is left alone (a downgrade stays a no-op); the request goes over the socket ("step down"), and the daemon exits through 001-122's path, finishing a running tier first, with one note. A daemon from before this row does not know the request: the hook then sends today's stop request instead. Own: `src/harness/shared/ensure.ts`, `src/core/daemon/lifecycle.ts` (the step-down entry), `server.ts` (one request), `src/core/types/` (additive), tests under `test/daemon/`, `test/harness/`, D10 in `spec.md`, one `status.md` line. Leave `src/harness/codex/` to the 002/003 coordinator; leave `src/core/scheduler/` to 001-124. Do not run `npm run build` or touch any `dist`. Done when: a real 0.1.x daemon started from an older bundle steps down when a newer hook runs, after its running tier, and a current daemon starts; an equal or newer daemon is untouched; the hook stays within its budget.

## 001-126 status says what its lines mean

Use /worker. Shape: slice. Defect 27. Outcome: the checkpoint and inherited lines cannot be read as "nothing is current". Read: `lessons.md` defect 27; spec D6, D7. Decided wording (adjust if a test shows it misleads): checkpoint, when results are current but no full run was requested since revision N: "Full-suite checkpoint: none requested since revision N (results above are for revision M; `squeal run --all` requests one)"; when one completed at the current revision, unchanged. Inherited: "Inherited from other worktrees: none (every result here was run in this worktree)" when 0. Same in delivery headers where these appear, and in the skill's `references/reports.md`. Own: `src/core/state/` (`fullSuiteText`), `src/core/status/format-status.ts`, `src/core/delivery/format.ts` (these two lines only), their tests and any e2e header parser they break, `plugins/claude-code/skills/squeal/references/reports.md`, one `status.md` line. Do not run `npm run build` or touch any `dist`. Done when: the format tests cover both states of each line; the e2e header tests pass.

## 001-127 research: do cezar's process-group tests fail under Squeal

Use /researcher. Topic: `research/README.md` "process-group-tests-under-squeal". Output `research/process-group-tests-under-squeal.md`, probes under `research/probes/process-group-tests-under-squeal/`. Work on a fresh clone of `cezar` at the commit the task used (`1c97556a` in worktree `c8580be4`), never the live worktree or its store. Outcome: whether Squeal's daemon environment (a detached session leader, its own `TMPDIR`, its cwd switch, Vitest's pool settings) changes what `runner-shutdown-parity.test.ts` cursor S26 to S28 observe, or whether it is load or a test race; and if Squeal, the change that fixes it.

## 001-123 review of 001-122 (dispatch note)

Range: 001-122's four commits as landed (`17d7e19` to `10e0bcc` as cherry-picked), build `dbeb862`. The worker ran a host-wide `pkill -f` matching every e2e fixture daemon at about 13:56 UTC; failures other sessions saw then may come from that, not from the code.

## 001-128 research: Squeal observes runtime inputs itself

Use /researcher. Topic: `research/README.md` "observed-runtime-inputs". Output `research/observed-runtime-inputs.md`, probes under `research/probes/observed-runtime-inputs/` (throwaway). Use a fresh clone of `cezar` for the cezar part; never a live worktree or its store, never stop a daemon you did not start. Read spec 003's `node:test` observed closure first. Done when every question has a tagged answer or "not determined, because", and the recommendation names the mechanism, its blind spots, its cost on `cezar`, and the row's done-when.

## After 001-124 to 001-127

001-124, 001-125, 001-126 and `reviews/wave-12.md` S1 landed as 0.1.33 (`9c23b22`); 001-127 found defect 28 was real failures kept current by a runtime read outside the closure, which 001-128 addresses. Reviews on gpt-6.1-sol for the two scheduler and daemon changes.

## 001-129 review of 001-124 and 001-125

Use /reviewer. Range: 001-124 (`9a6872f` to `61facb7` as cherry-picked) and 001-125 (`3cf205a` to `79b0d43`), build `9c23b22`. Output `reviews/wave-12b.md`. Outcome: (1) can a backlog tier store a result that is not current, lose a completed file's result on cancel, starve edit work, or exceed `runner.timeoutMs`; (2) can the step-down leave a worktree with no daemon, two daemons, or a newer daemon replaced by an older one. Probe: an edit at the first and last file of a backlog tier; a cancel that Vitest does not honour within 1 s; `backlogTierSize` 1 and 10,000; files with no known duration; a step-down while a tier runs, with a hook in the window, under both plugins; a 0.1.31 daemon (released bundle) and a pre-release version string.

## 001-130 a step-down never ends in an older daemon

Use /worker. Shape: repair. First repair round on the 001-125 slice; 001-131 re-reviews it. From `reviews/wave-12b.md` B1 (proven with released bundles: a 0.1.33 hook stepped down a 0.1.32 daemon, then a released 0.1.31 hook took the next boundary and started a 0.1.31 daemon) and S1 (wording).

Outcome: asking an older daemon to step down can only end with a daemon at least as new as the one that stepped down, under any mix of plugin versions on one worktree.

Read: `reviews/wave-12b.md` B1, S1; spec D10 (ensure, step-down, lock, 001-122's departure exit); `src/harness/shared/ensure.ts` (`stepDownIfOlder`), `src/core/daemon/` (start, lock, handlers).

Decided by the coordinator:
- **Do not step down while an older client is present.** Each registration records the hook's Squeal version with the consumer (additive, beside the harness record). A hook asks for a step-down only when the daemon is strictly older and every registered consumer's recorded version is at least the hook's own; a consumer with no recorded version (any release before this row) counts as older. So a mixed worktree keeps its current daemon until the older sessions leave (001-122 then exits it within 3 s), and the next newer hook starts a newer one.
- **The requesting hook arranges its successor.** After a step-down is accepted, the hook spawns its own bundle's daemon with a lock wait (a new `squeal daemon --await-lock <ms>` mode, bounded, about 2 minutes): it waits for the old daemon to release the lock instead of exiting at once, then starts as usual; if the lock is taken by anything else when freed (another hook's spawn), it exits as today.
- **S1:** reword the backlog budget comments and D5: the budget limits the files' last-known run time; unknown durations count 0; the first file is always taken; cancellation has a grace before force. No hard wall-clock cap in this row.

Own: `src/harness/shared/ensure.ts` and registration (`context.ts`/`hook.ts` as 001-122 left them), `src/core/delivery/` (the consumer version record), `src/core/daemon/` start and lock path and `src/cli/daemon.ts` (the flag), `src/core/scheduler/backlog.ts` and `tiers.ts` (S1 comments only), `src/core/types/` (additive), tests under `test/daemon/`, `test/harness/`, `test/delivery/`, D5 and D10 in `spec.md`, one `status.md` line. Ask before `src/harness/codex/`. Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: the review's B1 sequence with released bundles (a 0.1.32 daemon, a current Codex hook, then a released 0.1.31 Claude Code hook) ends with the 0.1.32 daemon still serving (no step-down, since the 0.1.31 consumer is registered), or with a current daemon, never 0.1.31; with only current consumers, a step-down ends with the requesting bundle's daemon serving within the lock wait, without a further tool boundary; a successor whose lock wait times out exits with a note; equal and newer daemons stay untouched.

## 001-131 re-review of 001-130

Use /reviewer. Range: 001-130's four commits as landed (`ca19ee0` to `7f976a3` as cherry-picked), build `7f62b20`. Output `reviews/wave-12c.md`. Last round on the 001-125 slice: blockers go to the human. Re-run the B1 sequence with released bundles in both orders and plugins; probe a consumer that never records a version, two newer hooks racing to spawn successors, the lock wait timing out, and a step-down while a tier runs.

## 001-132 Squeal observes the files a test reads at run time

Use /worker. Shape: slice. Decided by the human (2026-10-08): build `research/observed-runtime-inputs.md`'s recommendation, on by default, with batched writes; a policy key turns it off per project. A gpt-6.1-sol review (001-133) follows.

Outcome: a test whose result depends on a project file it reads, a script it spawns or a worker it starts re-runs when that file changes, with no `inputs` written by anyone; cezar's `runner-shutdown-parity.test.ts` re-runs when `scripts/mock-cursor-print.mjs` changes.

Read: `research/observed-runtime-inputs.md` in full (mechanism, the exact D3/D4/D5 sentences, blind spots, the A/B contention result); spec D3, D4, D5, D11; spec 003 D5 and its decision 3 (a `node:test` test is not observed past a spawn: this row reverses that for the recorder's reach, so name it in D3 and leave spec 003's text to its coordinator); `src/runners/node-test/runtime/recorder.cjs` and the observed-path store spec 003 built.

Decided:
- **One recorder for both runners,** a new CommonJS `--require` module under `src/runners/observe/` (not an edit of spec 003's `recorder.cjs`; that runner adopts the shared one in a 003 row of its own coordinator's). It wraps `fs`, `ChildProcess.prototype.spawn` and the sync spawn calls, and `Worker`; it never changes a call's behaviour or result, and a recorder error is swallowed.
- **Reach:** at each spawn it puts `--require <recorder>` and its own settings into the child's `NODE_OPTIONS`, including an `env: {}` child, so it reaches grandchildren. It records only paths inside the worktree that the watcher tracks (not ignored, not `node_modules`, not the snapshot, not the run's own temp dirs); everything else is dropped in the recorder.
- **Batched writes:** paths are kept in memory per process and written once at exit (and on a periodic flush for long processes), never one write per call, to keep the cost off deadline-bound tests.
- **Vitest wiring** through `createVitest`'s `env.NODE_OPTIONS`, as the research found reaches per-config projects; attribution by `__vitest_worker__.filepath`.
- **Keys:** observed paths join the test file's closure through the shared, merge-only observed set spec 003 built (generalized beyond `node:test`); a listed directory is keyed by its entry names; a first run stores its result under the key that includes what it observed. D5's stability check covers observed paths.
- **Policy key** `observe.runtimeInputs` (default `true`); `inputs` stays as the override for the blind spots. Status names the blind spots once.

Own: `src/runners/observe/` (new), `src/runners/vitest/` (wiring, attribution, closure), `src/core/keys/` (observed paths in closures), the generalized observed-set code wherever spec 003 put it (additive; ask before changing its existing behaviour), `src/core/scheduler/` (stability check only), `src/core/types/policy.ts` and `src/core/daemon/policy.ts` (the key), tests under `test/runners/`, `test/keys/`, `test/scheduler/`, `test/fixtures/`, D3, D4, D5, D11 in `spec.md`, `plugins/claude-code/skills/squeal/references/policy.md`, one `status.md` line. Leave `src/runners/node-test/` to the 002/003 coordinator (003-33 and 003-19 are running there). Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when (the research's): (1) on a fixture under Vitest 5 forks and threads, a test that reads a data file, spawns a `node` script with `env: {}` that spawns a grandchild, and starts a Worker re-runs when any of those files changes, with no `inputs`, and a listed directory gaining a file re-runs its test; (2) on a `cezar` clone with no `inputs`, editing `scripts/mock-cursor-print.mjs` re-keys and runs `runner-shutdown-parity.test.ts` at the next tier, and a second worktree with the old mock does not inherit the new result; (3) three full `cezar` suites each way show no file failing only with the recorder, or each such failure is shown to be load; (4) `observe.runtimeInputs: false` restores today's keys; (5) status names the blind spots; cost per file on `cezar` reported.

## 001-133 review of 001-132

Use /reviewer. Range: 001-132's commits as landed. Output `reviews/wave-12d.md`. Outcome: can the recorder change a test's result, miss a read that changes a result inside its stated reach, or keep a result current that a changed observed file invalidates. Probe the research's blind spots stay stated, an `env: {}` grandchild, worker threads, a test that writes then reads its own file, a symlinked source path, two worktrees sharing observed sets, the stability check during a run, and the contention result on `cezar`.

## 001-133 dispatch note

001-132 landed as 0.1.35. Range: its twelve commits as cherry-picked (`5125e99` to `c9c5612` in the worker's branch; on `main` the commits after `0c8bd5d` whose subject names 001-132) plus the build. Its evidence is in `tasks/001-132/notes.md`. Take especially: done-when 3's `on 1` round, where nine files failed only with the recorder and were attributed to load from overlapping runs (summed file time 11,319 s against about 6,500 s for the others); whether that attribution holds. Its brief noted `scripts/mock-cursor-print.mjs` is not on cezar's `main`; the cezar check used `1c97556a`.

## After 001-133

`reviews/wave-12d.md` failed 001-132 on six proven blockers. First repair round on the 001-132 slice, in two rows on disjoint files, then one re-review (001-136). N1 fixed by the coordinator. S1 (the `on 1` attribution) is 001-137, run after the repairs land.

## 001-134 observed inputs are keyed soundly in the scheduler

Use /worker. Shape: repair. `reviews/wave-12d.md` B1 and B5 (each has a fixture and fix steps).

Outcome: no result is stored under a key whose observed inputs were not stable across its run, and a recursive listing re-keys on any change it returned.

Decided: B1: a path observed for the first time in a run has no pre-run evidence; such a result is not stored as current under the key that includes the path. The run's result for that file is discarded (the file stays pending), the path is merged into the observed set, and the file re-runs under its full key at the next tier. A path with a pre-run hash is checked by D5's stability check as today. B5: a recursive `readdir` records each visited directory's immediate listing (the recorder already sees the traversal or reports the root with a recursive flag that the scheduler expands to each directory's listing); ordinary shallow listings unchanged.

Own: `src/core/scheduler/` (tiers, keying, stability), `src/core/keys/` (observed set, listing keys), tests under `test/scheduler/`, `test/keys/`, D3 and D5 in `spec.md`, one `status.md` line. If B5 needs a recorder field, agree its shape with 001-135 through the coordinator. Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: the review's B1 probe (a test that creates the file it reads mid-run) never stores pass under the present-file key and a second worktree does not inherit it; B5's probe re-keys on a nested addition and removal; the cost of the extra re-run is reported on the cezar measurement set (how many files re-run once on first observation).

## 001-135 the recorder records what a test reads, and changes nothing

Use /worker. Shape: repair. `reviews/wave-12d.md` B2, B3, B4, B6 (each has a fixture and fix steps).

Outcome: reads through a file symlink, `r+` and other readable opens, reads in a `SHARE_ENV` Worker are all recorded, and the recorder never changes the outcome of a spawn call.

Decided as the review says: B2 key both the link path and its in-scope target; B3 classify actual reads and writes, not open flags; B4 carry attribution into shared-env threads without copying the env or touching `workerData`; B6 inject only into valid spawn overloads, passing invalid calls through unchanged so Node's own validation runs. Bump the recorder version.

Own: `src/runners/observe/`, `src/runners/vitest/observe.ts`, tests under `test/runners/`, `test/fixtures/` (recorder fixtures), D4 in `spec.md`, one `status.md` line. Leave `src/core/scheduler/` and `src/core/keys/` to 001-134. Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: each of B2, B3, B4, B6's probes is a test that fails before and passes after, in both Vitest pools where the probe applies; the recorder's existing fixture tests stay green.

## 001-136 re-review of 001-134 and 001-135

Use /reviewer. Last round on the 001-132 slice: blockers go to the human. Output `reviews/wave-12e.md`. Re-run `reviews/wave-12d.md`'s six probes and S2; probe a file created then deleted within a run, a symlink retarget out of the worktree, `O_RDWR` numeric flags, a shared-env worker's own children, and every spawn overload's invalid forms.

## 001-137 evidence: does the recorder cause cezar's contention failures

Use /researcher. `reviews/wave-12d.md` S1: run the nine `on 1` files in a bounded alternating on/off comparison under a fixed competing workload, fixed Vitest concurrency and unchanged deadlines, on a fresh cezar clone; record per-file outcomes, worker and child counts, overlap timestamps and load through each run. Output appended to `tasks/001-132/notes.md` as a dated section, and replace "shown to be load" there with what the evidence supports.
