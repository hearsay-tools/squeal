# Probes: who kills a daemon started inside a cezar worktree (throwaway)

Throwaway scripts and trimmed logs for `../../daemon-sigkill.md` (task 001-180). Not product code; nothing here is imported, built or tested by Squeal. Delete freely.

Run on 2026-10-11 from 05:15 to 06:35 UTC, with Node 24.21.0, Squeal 0.1.110 (`~/.claude/plugins/cache/hearsay/squeal/0.1.110`), and cezar in a scratch clone at `ac1ea1a8`, then `c07b0bfc`.

## Rules followed

- Every tree was mine, under `/tmp`, and is removed at the end: `/tmp/sq180-cz-94e1b872`, a `git clone` of `/home/agent/projects/cezar` with its own `.git` and its own Squeal store, and `/tmp/sq180-mini-94e1b872`, a new repository. A clone, rather than a worktree, keeps the human's cezar store out of reach.
- Nothing was edited in `/home/agent/projects/cezar` or in any live worktree. No daemon of the human's was started, stopped or signalled. The slow lane was left out of the scratch config, so no host-wide slow permit was taken.
- Stores and run stores were opened read only. `/var/log/kern.log*` and `/var/log/syslog.1` were read with `sudo -n grep`/`zgrep`, which changes nothing. No credentials were read.
- Every run started from this task's cezar worktree with the agent's environment, as the killed 004-46 daemons were.

## Files

- `kill-guard.cjs`: a `NODE_OPTIONS=--require` preload. A `process.kill` aimed at 0, minus the caller's group, or the run's leader (`SQ180_LEADER`) is logged with its stack to `SQ180_LOG` and not sent.
- `leader.sh`: `export SQ180_LEADER=$$; exec "$@"`, run under `setsid -w`, so the command leads its own session and group, as `squeal daemon` does.
- `guard-vitest.sh <cezar> <out> <project> [vitest args]`: one Vitest project as a group leader with the guard in every Node process.
- `trace-vitest.sh <cezar> <out> <project> [vitest args]`: the same under `strace -f --seccomp-bpf` on `kill`, `tkill`, `tgkill` and `pidfd_send_signal`. It catches shell children too.
- `signals.mjs <strace.txt> <leader pid>`: every non-zero signal to 0, the leader or its group, plus counts by kind.
- `stress.sh <cezar> <out> <parallel> <rounds> <files...>`: `guard-vitest.sh` on a few files, many instances at once.
- `daemon-fg.mjs`: from `../../../../004-slow-suites/research/probes/dogfood2/`, unchanged. It spawns `squeal daemon <root>` detached and prints its exit code or signal.
- `daemon-window.sh <squeal.mjs> <root> <out> <s>`: one daemon through `daemon-fg.mjs` for a bounded window, with load per CPU every 5 s, then `squeal stop`.
- `mini/`: the repository of the mechanism check. `test/z-kill.test.js` sends `process.kill(Number(""), "SIGKILL")`. Run `npm i` in a copy, `git init` and commit, then `node daemon-fg.mjs <squeal.mjs> <copy>`.
- `setup.cjs <runs.db>`: every recorded `worktreeSetup` (start, seconds, status). `runs4.cjs <regex> <runs.db...>`: run-record timestamps matching a time of 2026-10-09. `notes2.cjs <from> <to> <store...>`: every Squeal note in a window.
- `logs/`: `mini.daemon.txt` and `mini.guard.ndjson` (the mechanism and the guard's sanity check); `run1.summary.txt` (strace); `run2.summary.txt` and `run3.summary.txt` and `run3.guard.ndjson` (guarded full suites; the catch); `focus-desc.summary.txt`; `stress1.summary.txt`; `d1.summary.txt` (the real daemon from this worktree); `kernel-oom.txt`; `cezar-setups.txt`; `run-events-1520-1535.txt`; `squeal-notes-1524-1531.txt`.
