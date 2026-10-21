# Probes for hearsay-tools/squeal#65 (throwaway)

Throwaway, not product code. Findings: `../../issue-65.md`.

- `run.sh` with `fixture/`: a live Squeal daemon (a copy of the installed plugin, 0.1.234 by default, or
  the plugin directory given as the first argument) on a scratch repository in a fresh `/tmp/i65-*` with
  its own `HOME` and `XDG_RUNTIME_DIR`. It refuses to run when the one-minute load is at or above the CPU
  count. It runs `npm install` of vitest 4.1.10 there, `squeal run --all --wait`, then
  `squeal status --json <2 paths>` and `squeal status --wait 30000 --json <2 paths>`, and applies jq
  filters on `.named.testFiles` and `.wait.testFiles` to both outputs. It stops its daemon and removes
  the directory.
- `sh run.sh > output-0.1.234.txt 2>&1`,
  `sh run.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.233 > output-0.1.233.txt 2>&1`.

No `node_modules`, store or JSON output is committed; the two `output-*.txt` files are the evidence.
