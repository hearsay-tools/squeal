# Probes for hearsay-tools/squeal#56 (throwaway)

Throwaway, not product code. Findings: `../../issue-56.md`.

- `recorder-probe.mjs`: the shipped recorder alone, no Vitest, no daemon. Writes under a fresh
  `$TMPDIR/squeal-issue56-*`, removed at the end.
  `node recorder-probe.mjs ~/.claude/plugins/cache/hearsay/squeal/0.1.231` → `output-recorder-probe.txt`.
- `run.sh` with `fixture/`: a live 0.1.231 daemon on a scratch repository in a fresh `/tmp/i56-*` with
  its own `HOME` and `XDG_RUNTIME_DIR`; refuses to run when the one-minute load is at or above the CPU
  count; stops its daemon and removes the directory. Runs `npm install` of vitest 4.1.10 there.
  `sh run.sh` → `output-run1.txt`.

No `node_modules` is committed.
