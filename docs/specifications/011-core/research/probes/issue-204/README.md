# Probe for issue #204 (throwaway)

Throwaway probe. Not product code. `run.sh` builds a private Git repository under
`$PROBE_DIR` (default `$TMPDIR/issue-204`), with its own store under that repository's
`.git/squeal/`, a private `HOME`, and 12 trivial Vitest files. It reuses this worktree's
`node_modules` through a symlink (no install). It never touches this repository's store
or daemon. Output of the recorded run: `out/`.
