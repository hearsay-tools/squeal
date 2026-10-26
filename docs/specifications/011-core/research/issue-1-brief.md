# Research brief 011-249: a daemon stops on a signal and stays stopped (gh-1)

Use /researcher. Shape: research. Outcome: who sends the signal that stops a daemon during an active task, how often it happens, and why no hook starts a new daemon, as the evidence a fix row is written from.

## Why

Issue #1 has 13 reports. The newest (2026-10-25, Codex) has the note `daemon stopped: signal` at 09:43:52Z from 0.1.308. The session's hooks moved to 0.1.309 about then, and validation stayed off for about 3 minutes, until the agent ran `squeal start`. With about 20 releases on 2026-10-25, an update that stops a daemon and starts none would cost every active session its checks at each release. The human approved this research on 2026-10-26.

## Read first

Issue #1 and all its comments; 011 C9 (lifetime, exits, the handoff between versions, `squeal start`), C13 (notes), C10 only where a permit is released at exit; `src/core/daemon/signals.ts`, `terminate.ts`, `lifecycle.ts`, `ensure.ts`; `src/cli/stop.ts`, `src/cli/hold.ts`, the launcher and `squeal update`.

## Questions

1. **How often.** On copies of the stores on this host (Squeal's own and cezarion's worktrees, whatever is kept), count the `daemon stopped: signal` notes by day and version against all daemon exits. For each, give the time until the next daemon started in that worktree.
2. **Releases.** Set each signal stop beside the nearest release (tag time, hub commit, plugin cache refresh) and beside the version that exited and the version that started next.
3. **Senders.** Every code path in Squeal that signals a daemon (callers of `terminate.ts`, `stop`, `update`, the handoff, an older daemon's exit), and every sender outside Squeal that can reach a daemon on this host: Cezar's worker stop and destroy, the harness ending a hook's process group or session (Codex and Claude Code), leftover sweeps, a closed terminal (SIGHUP). For each: the signal, when it fires, and whether a report's time and version fit it.
4. **Why it stays stopped.** After such a stop, which hook or command starts a new daemon in Codex and in Claude Code, and why the reporter needed `squeal start`.
5. **Naming the sender.** What Node offers to learn a signal's sender, and what else Squeal could record (for example, a mark its own senders write before they signal). No design.

## Rules

- Copy a store (with its `-wal` and `-shm`) before reading it. Never open a live store, connect to a live daemon socket or touch the live permit pool. Never signal a process you did not start. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- Experiments run in clones under `/tmp`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME`, `PLUGIN_DATA` and the npm, pnpm and corepack homes under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA` before you set your own. Nice 10, no test suite runs, and give the one-minute load beside every timing. Make no CPU load on purpose.
- Stop everything you started and remove your clones at the end.
- Tag every finding: `verified by experiment`, `read in source code`, `read from store`, `read in official docs` or `inferred`. Lead with counts and minutes, then n. Budget about one hour; if a question needs more, stop and say what it needs.

Own `research/issue-1.md` and `research/probes/issue-1/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 5 each have an answer with tags, and the probe README says how to re-run each experiment. Commit.
