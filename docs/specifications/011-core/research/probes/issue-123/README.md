# Probe for hearsay-tools/squeal#123 (throwaway)

Throwaway, not product code, not in the suite. Findings: `../../issue-123.md`.

- `run.sh`: a live daemon (a copy of the installed 0.1.374 plugin; `SQUEAL_PLUGIN` overrides) on a scratch
  repository in a fresh `/tmp/i123-*` with its own `HOME` and `XDG_RUNTIME_DIR`. Refuses to run when the
  one-minute load is at or above the CPU count. Generates 24 fast Vitest 4.1.10 files of 13 parity-style rows,
  runs a `vitest -t` regex control, then focused waits (`status --wait ... --check`), stops its daemon and
  removes the directory. `sh run.sh` → `output.txt`.

No `node_modules` is committed.

`output.txt` is from the first run, 2026-10-28T17:10Z, load 15.24 on 24 CPUs. That run also had a `--json`
step whose reader assumed `selection.focused` is an array; it threw (shown in `output.txt`) and was removed
from `run.sh` afterwards. The text output carries the findings. The `exit 0` after phase C is `head`'s.
