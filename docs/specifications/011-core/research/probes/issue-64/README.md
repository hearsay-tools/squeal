# Probe for hearsay-tools/squeal#64 (throwaway)

Throwaway, not product code, not in the suite. Findings: `../../issue-64.md`.

- `run.sh` with `fixture/`: a live daemon (a copy of the installed 0.1.233 plugin; `SQUEAL_PLUGIN` overrides) on a
  scratch repository in a fresh `/tmp/i64-*` with its own `HOME` and `XDG_RUNTIME_DIR`. Refuses to run when the
  one-minute load is at or above the CPU count. Installs vitest 4.1.10 there, times the daemon's red verdict for
  two checks appended to a 30-check, 12 s file against `vitest -t`, stops its daemon and removes the directory.
  `sh run.sh` → `output-run1.txt`.

No `node_modules` is committed.
