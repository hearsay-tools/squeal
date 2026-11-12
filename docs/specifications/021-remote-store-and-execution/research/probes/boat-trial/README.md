# Probe boat-trial (throwaway)

Throwaway. These files ran row 021-15 once, on boat.dev, in November 2026, and are not maintained. Findings: `../../boat-trial.md`.

Every Squeal run used a clone of this repository under `$TMPDIR` with `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `$TMPDIR` (`env.sh` below). SSH used only the trial key `/home/agent/.config/squeal-remote-trial/id_ed25519`, never `~/.ssh`. The boat.dev API key came from the agent-vault proxy; no file here holds it.

| File | What it is |
|---|---|
| `boat.sh` | boat.dev API calls (create, get, stop, resume, usage, limits) and `sshkey`: authorizes the trial key and writes `known_hosts` and an ssh `config` that pin the host key the API returns for this start (`StrictHostKeyChecking yes`, `HostKeyAlias boat-trial`). Run `sshkey` again after each resume. |
| `setup-remote.sh` | Runs on the sandbox over `ssh boat-trial sh -s <version>`: Node from nodejs.org, checksum checked, linked into `~/.local/bin`, that directory put first on the `PATH` at the top of `~/.bashrc` (a non-interactive ssh runs it) and in `~/.profile`; `corepack enable`. With `--only-install` it installs a second Node and links nothing. |
| `remote-monitor.sh` | On the sandbox, every 0.5 s: bytes in and out, load, and which first-connect marks exist (bundle, `files.json`, `node_modules`, `installed.json`). Copy it there first; `sh -s` in the background loses its input. |
| `daemon.sh` | Runs `squeal daemon <clone>` with each stderr line timestamped into `daemon.log`: `squeal start` discards the daemon's log. Started as a long job. |
| `lane.sh` | `on` copies the chosen `remote.json` into the isolated config, `off` removes it; then restarts the daemon and waits until it serves. |
| `edit-run.sh`, `bench.sh`, `bench2.sh` | One revision that appends a comment line to each named test file (a catch-up revision of 10 keyed paths, so a backlog tier, so remote), then `squeal status --wait` on them; the benches repeat it, each edit only at load under 24, for set A (`test/capacity`) and set B (`unit-files.txt`). |
| `note-watch.sh` | Prints the remote-lane note of `squeal status --notes` when it changes. |
| `fullrun-local.sh` | The whole suite here under the full-run lock, load sampled each minute. |
| `runs.cjs` | Reads a copy of the clone's store: each run's daemon time, Vitest's own time, and whether it ran here (`here/`). |
| `echo.mjs` | Round trips of one line over one ssh session. |
| `edit-timings.txt`, `runs.txt`, `daemon-log.txt`, `full-suite.txt` | The raw numbers: edit to result per edit, the run rows, the daemon's timestamped log, both whole-suite runs' failures. |
| `lost-files.txt`, `unit-files.txt` | The 14 files of the lost-remote run, and set B. |

`env.sh` and the `ssh` wrapper lived in the scratch directory:

```sh
T=$TMPDIR/trial
export HOME=$T/home XDG_CONFIG_HOME=$T/home/.config XDG_CACHE_HOME=$T/home/.cache \
  XDG_DATA_HOME=$T/home/.local/share XDG_STATE_HOME=$T/home/.local/state XDG_RUNTIME_DIR=$T/run
export PATH=$T/bin:<node 26.13.0>/bin:$PATH
unset SSH_AUTH_SOCK
```

`$T/bin/ssh` is `exec /usr/bin/ssh -F $T/ssh/config "$@"`: OpenSSH reads `~/.ssh/config` from the password database's home, not from `$HOME`, so an isolated `HOME` alone does not give ssh another configuration.
