# Probes for `node-test-left-out.md` (row 018-55)

Throwaway. Nothing here is product code or a test. Run on 2026-11-20 in
`$TMPDIR/r55`, outside every repository checkout. No Squeal daemon was
started; the cezar clone held no `.squeal` directory afterwards and
`git status` stayed clean.

## Setup that was run

1. `gh run download 44805319389 -R hearsay-tools/squawk` into `parts/`
   (`squeal-parts-shard-1..8`, `squeal-parts-node-test`). Read-only.
   The two node:test parts (`runner: "node-test"`) were copied alone into
   `parts/nt-only/{package,scripts}`: `package/eeb77897…` and
   `scripts/613c9e96…`. The other 26 parts under `scripts/` are the nested
   Vitest parts of row 018-54 and were left out, as the brief says.
2. `git clone` of `hearsay-tools/squawk` at `cd8cea696` (the run's head),
   then `pnpm@12.11.2 install --frozen-lockfile` on Node 26.13.0, with
   `HOME` and the pnpm store under `$TMPDIR/r55`, `CI=true`. No build: the
   export job builds nothing.
3. Squeal 0.1.579: a copy of this worktree's `plugins/claude-code/dist`
   (`git diff v0.1.579 -- plugins/claude-code/dist` is empty). One patch:
   `uncertifiedLines` writes every left-out file and its inputs as JSON to
   `$SQUEAL_PROBE_UNCERTIFIED` (the CLI prints 3). No result changes.

## Runs

- Export, as the CI job runs it, over the 8 shard dirs and the two node:test
  dirs: 1330 files exported, 568 left out for inputs (server 415, web 37,
  `test:unit` 5, `root:test:unit` 111). node:test: 37 of 153 exported.
- Export over the 8 shard dirs alone: 1293 exported, 452 left out. The
  Vitest left-out set does not depend on the node:test parts.
- `classify.mjs uncertified.json cezar <part dirs>` → `pairs.json`: per
  left-out (file, input) pair, its kind in the clone (tracked, untracked,
  missing), its value in the file's own part (absent, equal, differs), whether
  the file observed it, and which other parts hold it. `ONLY_VITEST=1` picks
  the Vitest files instead.
- `causes.mjs pairs.json cezar <node:test part dirs>` → `causes.tsv` (kept
  here): one cause per pair, per file its causes and test seconds; the
  summary on stderr is quoted in the findings.
- `strace -f -e trace=openat,open,stat,statx,newfstatat` of
  `node --import ../../scripts/test-home-env.mjs --import tsx --test
  test/unit/workflow-types.test.ts` in `packages/cezar` (HOME and TMPDIR in
  scratch): tsx opens `packages/cezar/tsconfig.json` and no other
  tsconfig, while the test loads `packages/contract/src/runner.ts`.

The clone, the artifacts, `pairs*.json` and the patched bundle stay in
`$TMPDIR` and are not committed.
