# Probes for row 005-99 (throwaway)

These scripts are throwaway. They back `../../daemon-restart-per-turn.md` and are not product code. They read logs, transcripts and `/proc`. They write nothing outside stdout, open no socket and signal no process. The store is opened with `immutable=1` and `readOnly` (no lock taken, the WAL not read, so the last minutes before the read are missing).

Run with Node 22.5 or later (`node:sqlite`). The outputs went to the task's scratch directory and are not kept.

| Script | Reads | Gives |
|---|---|---|
| `lib.mjs` | `<repo>/.git/squeal/logs/daemon-*.log` | per daemon process: first line, `serving` line, first `daemon stopped` line and its reason, root; busy-CPU numbers from the pool's log lines |
| `turns.mjs <repo>...` | Squawk run logs `<repo>/.ai/squawk/runs/*.ndjson`, the daemon logs | one line per `SessionStart` hook of a Claude Code step: source, hook status, registration text flags, whether a daemon served at that moment, the time to the next daemon's `serving` line, busy CPUs |
| `ends.mjs <repo>...` | the same | one line per Squawk `session.ended` (Claude Code and Codex): whether a daemon served, when and why it stopped, the time to the run's next session start (`UNTIL` cuts runs with none) |
| `concurrency.mjs ends.jsonl` | `ends.mjs` output | for keep times K: the mean and maximum number of daemons kept at once if each session end kept its daemon K minutes |
| `window.mjs turns.jsonl` | Claude Code transcripts `~/.claude/projects/<cwd>/<session>.jsonl` | per resume that started a daemon: tool calls, edits, waits, hand test runs and the first line of each SQUEAL hook text from the start to `serving`; `CONTROL=1` takes the window of the same length after `serving` |
| `edits.mjs <repo>` | the store (`revisions`, `runs`, `worktrees`) and the daemon logs | per watch or interval revision: the daemon's state then (starting, serving under 5 min, serving 5 min or more) and the time to the first run at that revision or later |
| `start-writes.mjs <repo>` | the daemon logs | per daemon start: the long store writes (lock held 250 ms or more) logged before `serving` |
| `restarts.mjs <repo>` | the daemon logs | each start classed by the previous daemon's stop reason and the time since it; `ONLY` or `SKIP` a worktree id |
| `watch-starts.sh <seconds>` | `/proc` | every 2 s: each live daemon's pid, age, CPU seconds, private MiB and the 1-minute load |
| `start-cpu.mjs starts.tsv <repo>...` | `watch-starts.sh` output, the daemon logs | per daemon seen within 15 s of its spawn: CPU seconds and private memory at its `serving` line |

Example: `SINCE=2026-11-14T00:00:00Z node turns.mjs ~/projects/cezar ~/projects/squeal > turns.jsonl`.
