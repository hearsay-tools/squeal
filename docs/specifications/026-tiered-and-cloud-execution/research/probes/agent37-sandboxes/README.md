# Probes for `agent37-sandboxes` (throwaway)

Throwaway scripts of the 026 research topic `agent37-sandboxes` (`../../agent37-sandboxes.md`). Not product code, not maintained. Run on 2026-11-23 and 2026-11-24 (UTC) against Squeal `62e4e3b56` (0.1.611) on Agent37 instances from template `agent37-base` (image `base:2026.10.24a`). The `dsync.sh`, `run-tests.sh` and `setup-node.sh` probes are the ones in `../boat-sandboxes/`, copied to each instance unchanged, so the numbers compare with `../../boat-sandboxes.md`.

All API calls go through the agent-vault proxy with a placeholder key. No script reads, prints or stores a credential. The temporary SSH key and ssh config lived under `$TMPDIR`; nothing under `~/.ssh` was read or written.

| File | What it does |
|---|---|
| `a37.sh` | One API call (control plane `api.agent37.com`, or `sandbox.agent37.app` with `A37_PLANE=sandbox`), with the HTTP code and time on stderr. |
| `rx.sh` | Runs a local script on an instance through `exec` (base64 in the command; `RX_BG=1` detaches it and logs to `/tmp/rx-<name>.log`). |
| `put.sh` | Copies a small file to `/tmp` on an instance through `exec`. |
| `logs.sh` | Prints one `/tmp` log from each instance. |
| `env.sh` | Kernel, CPU, memory, disks and mounts of an instance. |
| `setup.sh` | Node 26.13.0 (via `../boat-sandboxes/setup-node.sh`), `git clone` of the public repository at a commit, `pnpm install --frozen-lockfile`, timed. |
| `suite.sh` | The measurement set on one instance: `dsync.sh`, 10 `test/capacity` files twice, the 3 D2 Git files, `driver.mjs` (coverage off and on, and node:test) run on the instance itself, `compat.mjs`, `cpu.mjs`, a 50-file `test/scheduler` slice twice, `dsync.sh` again. |
| `driver.mjs` | `../boat-sandboxes/driver.mjs` with one change: the ssh argument may be `"local"` to run the runner host through `sh -c` on the same machine. |
| `nt-fixture.sh` | A one-file node:test fixture for `driver.mjs nodetest`. |
| `compat.mjs` | `nice`, process-group kill, SQLite WAL across two processes and commit cost, `fs.watch` (plain and recursive), `realpath`. |
| `cpu.mjs`, `cpu-run.sh` | One-thread and four-thread SHA-256 throughput per 5 s window for 60 s, with `/proc/stat` before and after. |
| `tunnel.mjs` | An ssh `ProxyCommand` like `agent37 tunnel` (agent37 CLI 0.4.1), but through `HTTPS_PROXY`: CONNECT, TLS, WebSocket to `<id>-22022.agent37.app`. The CLI itself dials port 443 directly and ignores the proxy. |
| `sshcmd.sh` | Writes an ssh config under `$A37_HOME` (temporary key, no known_hosts, ControlMaster) and prints the ssh arguments. |
| `ssh-rtt.sh`, `rtt.sh` | Round trips from this host: new ssh connections, commands over a kept master; `exec` and control-plane `GET`. |
| `fork.sh`, `fork-check.sh` | `POST /fork`, wait for `running` and a first `exec`; then `git status`, `dsync.sh`, the Git files and `test/capacity` on the fork. |
| `sleepwake.sh` | Starts a marker process, `POST /sleep`, waits, then times the first `exec` (or, with `WAKE=ssh`, a new ssh connection) and reports whether the marker survived. |
| `results/` | Raw output. `cleanup.txt` records the deletes and the final empty lists. |

Instances made: `tcgutmnxqn` (US default), `c0myhlo00m` (EU vm), `8g96zbc4r3` (EU performance), forks `0pw82zjcfb` and `n9sbdno5an`. All deleted; `GET /v1/instances` and `GET /v1/ssh-keys` returned `{"data":[]}` at the end. Spend: $0.051 (99 awake minutes).
