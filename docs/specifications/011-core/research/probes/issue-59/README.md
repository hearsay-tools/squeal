# Probes for hearsay-tools/squeal#59 (throwaway)

Throwaway, not product code. Findings: `../../issue-59.md`.

- `run.sh` with `fixture/` and `summarize.mjs`: a live Squeal daemon (a copy of the installed plugin,
  0.1.232 by default, or the plugin directory given as the first argument) on a scratch repository in a
  fresh `/tmp/i59-*` with its own `HOME` and `XDG_RUNTIME_DIR`; refuses to run when the one-minute load
  is at or above the CPU count; stops its daemon and removes the directory. Runs `npm install` of
  vitest 4.1.10 there. `sh run.sh > output-0.1.232.txt 2>&1`,
  `sh run.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.231 > output-0.1.231.txt 2>&1`.
- `run-startup.sh`: the same isolation, with N generated trivial test files (default 300); eight
  mixed named waits from `squeal start`. `sh run-startup.sh > output-startup-0.1.232.txt 2>&1`.

No `node_modules` is committed.
