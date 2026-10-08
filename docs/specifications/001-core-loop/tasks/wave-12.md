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
