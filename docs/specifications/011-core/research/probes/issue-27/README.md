# Probe for hearsay-tools/squeal#27 (throwaway)

Throwaway, not product code. `probe.mjs` builds a scratch main repository plus one linked worktree at
`.ai/cezar/worktrees/run-1` under a fresh `/tmp/squeal-issue27-*` with its own `HOME` and
`XDG_RUNTIME_DIR`, hosts each session's hooks in a fake harness process (`harness.mjs`), and plays
four cases with an installed plugin's hook bundles. It stops and kills only daemons whose arguments
name its own worktree, and removes the directory.

    node probe.mjs ~/.claude/plugins/cache/hearsay/squeal/0.1.199

Output of the run the findings cite: `output-run1.txt`. No `node_modules`: Vitest never runs, so no
slow-file drain can occur.
