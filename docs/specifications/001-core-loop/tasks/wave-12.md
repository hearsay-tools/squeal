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
