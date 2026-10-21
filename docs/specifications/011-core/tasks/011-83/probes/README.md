# 011-83 probes

Throwaway scripts for `../design.md`. Each one names its method in its header.

| Script | What it does | Logs |
| --- | --- | --- |
| `host-snapshot.mjs [seconds]` | Reads the live host twice, `seconds` apart (default 10), read only: `/proc/<pid>/{stat,cmdline,environ}`, `/proc/{stat,loadavg,locks,pressure/cpu}`, the `stat` of the pool's permit files and the marks' JSON in `$XDG_RUNTIME_DIR/squeal`, and `~/.config/squeal/config.json`. Per daemon: its test processes (children with `SQUEAL_DAEMON_CHILD` at `nice` 10), what runs below them, its permits (write locks in `/proc/locks`), its mark (by the worktree id of its `PWD`) and its tree's CPU, with the times of the children reaped in the window. Opens no lock file, socket or store; signals nothing. | `logs/snapshot-1.json` (22:25:43 CEST), `logs/snapshot-2.json` (22:40:30), `logs/series/s01.json` to `s20.json` (22:29:28 to 22:33:21) |
| `summarize.mjs <log>` | Prints one snapshot's host line, permits, fresh marks and busy daemons. | |
| `series-table.mjs <logs>` | Tabulates snapshots and their spreads. | |
| `file-cpu.sh <clone> <scratch> <runs> <files>` | Runs each test file `runs` times in a `git clone` under `/tmp`, with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under the scratch directory, `env -i`, `nice -n 10`, `--maxWorkers=1`, under `/usr/bin/time` (Vitest's process and the descendants it waited for). Records the one-minute load before each run. | `logs/file-cpu.tsv` |
| `file-cpu-table.mjs <log>` | Tabulates `file-cpu.tsv`. | |

The clone was `/tmp/squeal-011-83/clone` at `90e442f7f`, with the `node_modules` of a worktree whose `package-lock.json` matched copied in (no install, no build). It was removed afterwards. Time zone: CEST (the logs' ISO times are UTC, two hours earlier).
