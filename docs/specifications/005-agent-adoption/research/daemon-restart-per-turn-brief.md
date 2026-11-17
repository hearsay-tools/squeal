# Research brief: a task alone in its worktree restarts its daemon at every turn

Row 005-99, approved by the human 2026-11-17 (research, no code). Coordinator: session 4d2ecbfc. Use /researcher. Findings file: `daemon-restart-per-turn.md` beside this brief. Joins row 011-385; read its row and say what this answers of it.

## Question

Under Squawk a session closes at each turn end. SessionEnd unregisters; with no consumer left the daemon stops 3 s later; the next turn starts one again (`../tasks/005-95/notes.md`, steps and last paragraph). What does this cost the agent, what would keeping the daemon cost the machine, and which option is worth a row?

## Measure

1. From stored runs, daemon logs and Squawk run logs of real tasks in this repository and in cezar (read-only): per turn, the time from the turn's start to the daemon's first heartbeat, to the test files listed, and to the first result for an edit; the same for turns where a daemon was already alive (another session in the worktree). Median, p90, n, and the host load of each sample.
2. How often: the share of turns that start a daemon, and the share of "no results yet" or "not listed" messages that follow such a start.
3. The memory a live idle daemon holds (resident size, from `/proc`, of daemons that run now) and how long daemons stay idle.
4. What a start repeats that the store already holds (the listing, the baseline lookup), from the code: `src/core/daemon/`, the consumer-count stop rule, `src/harness/shared/session.ts`.

## Options to weigh

Keep the daemon for a set time after the last session leaves; keep it only while a session is parked for a resume; reuse the last listing at start. For each: expected effect on 1 and 2, memory cost from 3, what it changes for users outside Squawk. The human's rule, 2026-11-12: many worktrees on normal memory come before speed per edit. A number tuned to this host is out; one derived from the machine is fine.

## Limits

Read-only on other tasks' worktrees, stores and logs. An experiment runs only in a scratch worktree of your own, at the host's real load, stated per run; make no load on purpose. Do not run `evals/bin` scripts. Never run a script to check it. Write `~`, never a `/home/<user>/` path. No product code changes.
