# Probe: running-tier-yields (THROWAWAY)

Throwaway probe for `011-core/research/running-tier-yields.md` (row 001-381, brief R1 of `tasks/wave-7.md`). Not product code; nothing imports it. No daemon, no Squeal build, no Vitest run and no live session ran: the host's one-minute load was 26 to 44 on 24 CPUs during the work (`results/env.txt`), above the brief's hold at 8. Every number is a replay of recorded data, read only.

Inputs:
- Cezar's store, copied once through a `readOnly` connection (`VACUUM INTO`) with `../catch-up/snapshot.mjs /home/agent/projects/cezar/.git/squeal/store.sqlite /tmp/r381/cezar-store.sqlite` at 2026-10-21T08:12Z. Every script reads the copy (`STORE` overrides the path).
- Cezar's run logs, `.git/squeal/runs/<run>/report.json`, read in place (no writes).
- Named waits, extracted read-only from the Claude Code transcripts (`~/.claude/projects/-home-agent-projects-cezar*`) and Codex sessions (`~/.codex/sessions/2026/10`) of cezar worktrees by `waits.mjs` into `/tmp/r381/waits.json` (not committed: it is transcript-derived).
- The host's load history, `sar -q -f /var/log/sysstat/saDD` (10-minute samples, local time UTC+2).

Scripts (run from this directory with no arguments, after the snapshot):
- `q.mjs "<sql>"`: one read-only query on the copy.
- `wt.mjs <worktree id>`: one worktree's revisions, runs and checkpoints in time order (`results/timeline-*.txt`: the two #69 reports).
- `waits.mjs`: the named-wait extraction (`results/waits.txt`).
- `cancels.mjs`: runs whose report says the scheduler cancelled them, and the time from the last revision during the run to its end (`results/cancels.{txt,json}`).
- `calibrate.mjs`: run walls against Vitest's module durations and the store's per-file sums of check durations (gh-62; `results/calibrate.txt`). `gh62.mjs`: the issue's own file (`results/gh62.txt`).
- `mid-tier.mjs`: questions 3 and 4. Revisions and named waits that land while a fast Vitest tier of the same worktree runs; their wait today; the yield rules replayed (`results/mid-tier.{txt,json}`).
- `load.mjs`: the recorded load at each cancel, episode and revision (`results/load.txt`).
