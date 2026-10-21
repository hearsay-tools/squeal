# Probe for gh-72 (throwaway)

Throwaway. Not product code. Findings: `../../issue-72.md`.

`probe.sh <plugin dir> <deps dir> [recover]` copies a built plugin twice under one `mktemp -d /tmp/sq72-XXXX` directory (its own HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, fixture repository and store). It starts a daemon from copy A, holds a tier of two files with four queued, deletes copy A, releases the hold and reads the result through copy B's CLI. `recover` also tries `retry`, then `stop`, `start` and `run --all --wait` through copy B. Each test spawns one `node -e` child after the hold, as a test that starts processes does.

It never touches the installed plugin or another daemon, and it stops only the fixture's own processes (matched by the unique mktemp path).

- `output-run1.txt`: the reproduction (17:37 UTC, load 11.92, 24 CPUs).
- `output-run2-recover.txt`: the same, then the recovery commands (17:39 UTC, load 16.00, 24 CPUs; stack lines filtered).
