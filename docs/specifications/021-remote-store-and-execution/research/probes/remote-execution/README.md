# Probes for topic `remote-execution` (row 021-02): throwaway

These scripts are throwaway. They supported `../../remote-execution.md` once, on 2026-11-11, and are not maintained. Nothing in Squeal uses them.

Every tool's state lives under `$TMPDIR/re` (`env.sh` sets `HOME`, `MUTAGEN_DATA_DIRECTORY` and `MUTAGEN_SSH_PATH` there; the SSH wrappers pass `-F` with a config whose key, `known_hosts` and control socket are under `$TMPDIR` or a `mktemp` directory in `/tmp`). The remote is a throwaway container on this host.

| File | What it does |
|---|---|
| `Dockerfile` | The remote: `node:24.22.1-bookworm-slim` with `openssh-server`, `rsync`, `git`. Tag `squeal-021-remote:throwaway`. |
| `env.sh` | Environment for every script. Source it. |
| `setup.sh` | Key pair, container `squeal-021-remote` on a loopback port, SSH config and wrappers. |
| `compare-tree.sh` | Git blob ids of every tracked regular file, local against remote. Squeal's file hash is the git blob id. |
| `race.sh` | Writes a file every 20 ms and runs `mutagen sync flush` five times; records the session state after each flush. |
| `conflict.sh` | Edits a file on both sides under `one-way-safe`, `one-way-replica`, `two-way-safe`. |
| `unreachable.sh` | Pauses the container, then flushes with a 45 s limit. |
| `remote-watch.mjs`, `latency.mjs` | Save-to-remote latency: the remote prints when a marker arrives; the driver appends markers locally. Host and container share one clock. **Never run**: the load stayed above 24 for the whole session. Usage: `node latency.mjs hot\|cold\|hot-flush\|cold-flush 5` after copying `remote-watch.mjs` to `/probe/` in the container. |
| `sar-days.sh`, `sar-days.txt` | Busy vCPUs and `%nice` per day from `/var/log/sysstat`. |
| `results/` | Raw outputs quoted in the findings file. |

Order: `setup.sh`, then `mutagen daemon start`, then
`mutagen sync create --name sq --sync-mode one-way-replica --ignore-vcs -i node_modules $RE/local/squeal remote:/work/squeal`
(after `ssh remote mkdir -p /work`), then the others. Clean-up: `mutagen sync terminate -a`, `mutagen daemon stop`, `docker rm -f squeal-021-remote`, `docker rmi squeal-021-remote:throwaway`, remove `$TMPDIR/re` and the `/tmp/sq021.*` directory.
