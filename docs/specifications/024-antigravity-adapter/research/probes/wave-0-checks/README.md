# wave-0-checks probes (throwaway)

Throwaway probes for row 024-01. Not product code; nothing imports them. Raw hook payloads they
record stay in `$TMPDIR` and are never committed; `../wave-0-checks.md` holds the sanitized shapes.

- `q1-binary-names.sh`: runs in an offline `ubuntu:24.04` container with a tmpfs `HOME`; copies the
  release binary to `~/.local/bin/agy` as the official installer does, runs `agy install`, and
  compares `plugin` help between `agy` and `antigravity`.
- `logger-plugin/`: a native plugin whose hooks append `{event, env, stdin}` records to
  `$AG_PROBE_LOG` (set by the runner) and continue `Stop` once per turn.
- `q2-installed-plugin.sh`: temp `HOME` with only the CLI's OAuth token file symlinked (never read
  or printed); installs `logger-plugin` with `plugin install`, runs live turns, disables, reinstalls,
  uninstalls, and prints `config.json` and `PLUGIN_DATA` state after each step.
- `run` and `q3-fast-path.py`: the POSIX `sh` `hooks/run --if-squeal` candidate and its byte-exact,
  tricky-payload and latency tests under `dash` and `bash`. Run `python3 -I q3-fast-path.py <dir>`
  with `<dir>` outside any git repository (the walk-up otherwise finds the enclosing repository).
- `q4-shapes.sh`: a turn that starts a background subagent (`fullyIdle: false`), then a turn cut
  by `--print-timeout`. `q4-sigint.sh`: SIGINT to the CLI mid-turn.
