# Probes for topic `runner-split` (row 021-04): throwaway

These scripts are throwaway. They supported `../../runner-split.md` once, on 2026-11-11, and are not maintained. Nothing in Squeal uses them.

SSH keys, `known_hosts`, the SSH `HOME` and the control socket live under `$TMPDIR/rs` or a `mktemp` directory in `/tmp` (`env.sh`, `setup.sh`). The remote is a throwaway container on this host. Squeal's clone (`$TMPDIR/rs/squeal`, this repository at `0fa197e09`, installed with `pnpm install --offline`) is mounted read-only at `/opt/squeal`; this directory at `/opt/rs`.

| File | What it does |
|---|---|
| `Dockerfile` | The remote: `node:24.22.1-bookworm-slim` with `openssh-server`, `rsync`, `git`, `procps`. Tag `squeal-021-rs:throwaway`. |
| `env.sh` | Environment for every script. Source it. |
| `make-fixture.sh` | A small Vitest 5.0.3 project in `$TMPDIR/rs/fixture`, a git repository, installed offline. |
| `setup.sh` | Image, key pair, container `squeal-021-rs` on a loopback port, SSH wrapper, first copy of the fixture with `node_modules`. |
| `host.mts` | The remote runner host: builds Squeal's own `createVitestAdapter` on the remote tree and answers JSON-line requests on stdio. Run as `cd /opt/squeal && node --import tsx /opt/rs/host.mts <root>`. |
| `driver.mjs` | The daemon's side: edit, rsync of the named path, `invalidate`, `affected`, `closure`, blob-id proof, `run`, proof. `node driver.mjs local\|remote [edits] [--observe] [--fail]`. Its `roundTrips` field undercounts by one; the findings count 7 calls plus 2 for rsync. |
| `timed.sh` | Runs `driver.mjs` local then remote, each only when the one-minute load is below 24. |
| `compare-env.mjs` | Compares the runner's answers on two roots. |
| `failure.mjs` | `drop`, `hang`, `noinstall`, `node2421` (Node v24.21.0 copied into the container first), `snapshot`. |
| `ssh-kill.sh` | Kills a local `ssh` process group, with and without `-tt`, and counts what is left on the remote. |
| `reset.sh` | Puts the fixture back at its last commit on both sides. |
| `results/` | Raw outputs quoted in the findings file. `functional-*` and `fail-*` ran at load 49 to 79: their timings are not used. |

Order: `make-fixture.sh`, `setup.sh`, then the others. Clean-up: `docker rm -f squeal-021-rs`, `docker rmi squeal-021-rs:throwaway`, `ssh -O exit` on the control socket, remove `$TMPDIR/rs` and `/tmp/sq021rs.*`.
