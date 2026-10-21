# Probe: yields-replay (THROWAWAY)

Throwaway probe for `011-core/research/yields-replay.md` (row 011-68, brief R1 of `tasks/wave-8.md`). Not product code; nothing imports it. No daemon, no Squeal build, no Vitest run and no live session ran: the one-minute load was 18.9 to 45.8 on 24 CPUs during the work (`results/env.txt`), above the brief's hold at 8. Every number is a replay of recorded data, read only.

Inputs:
- Cezar's store, copied once through a `readOnly` connection (`VACUUM INTO`) with `../catch-up/snapshot.mjs /home/agent/projects/cezar/.git/squeal/store.sqlite /tmp/r68/cezar-store.sqlite` at 2026-10-21T14:53:13Z. Every script reads the copy (`STORE` overrides the path).
- Cezar's run logs, `.git/squeal/runs/<run>/report.json`, read in place (no writes).
- Named waits, extracted read-only from the Claude Code transcripts and Codex sessions of cezar worktrees by `waits.mjs` (a copy of `../running-tier-yields/waits.mjs`) into `/tmp/r68/waits.json` (not committed: it is transcript-derived).
- The host's load history, `sar -q -f /var/log/sysstat/saDD` (10-minute samples, local time UTC+2).

Scripts (run from this directory with no arguments, after the snapshot and `waits.mjs`):
- `load-data.mjs`: shared loading. Fast Vitest tiers with their reports, the store's estimate per run and file (the sum of the file's results, as `durationOf`), one-file run walls, revisions, closures, named waits, load.
- `replay.mjs`: questions 1, 2 and 4. Tiers started before 0.1.237's release (12:53:22Z), replayed under 0.1.236's, 0.1.237's and 011-54's rules, thresholds 0 to 120 s, two duration sources (`results/replay.txt`).
- `observe.mjs`: what cezar's 0.1.237 and 0.1.238 daemons did after their start, against the model's decision for each tier (`results/observe.txt`).
- `q.mjs "<sql>"`: one read-only query on the copy.

A live check (question 3), if the load drops below 8: a scratch clone of cezar at its current SHA under `/tmp`, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` under it, Squeal 0.1.238 from its release tag; start the daemon, wait for the baseline, save one edit that queues a tier of `harness-*-parity.test.ts` files (200 to 600 s each), then `squeal status --wait 120000 <a short failing file's path>` 30 s later; record the wait's text, the time to the named verdict, and the load every 10 s.
