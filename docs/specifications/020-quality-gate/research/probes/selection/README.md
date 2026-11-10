# survey-020-15 probes (throwaway)

Research evidence for `../../selection.md`, not product tests. Nothing here is
imported by Squeal or run by its suites. `.scratch/` is ignored and never
committed. No probe writes in `~/projects/cezar`.

- `static-closure.mjs <repo> <commit> <changed,...> <entry>...`: a static walk
  of relative imports, read with `git show <commit>:<path>` (no checkout, no
  Vitest). It approximates Vite's graph: relative specifiers only, no aliases,
  no package `exports`. Run on 2026-11-10 against cezar at `e831c2c67`
  (incident 1, base `819ec5af0`) and `154cba614` (incident 2, the parent as
  base). Outputs: `incident1.out.json`, `incident2.out.json`. Commands are in
  `../../selection.md`, Q5.
- `stdout-redirect.mjs`: replaces `process.stdout.write` with a write to
  stderr, prints in-process, from a child with inherited stdio and from a
  piped child. Output: `stdout-redirect.out.txt`. Node 24.22.1.
- `fixture.mjs [<squeal.mjs>]`: builds #172's shape in an isolated Git
  repository under `.scratch/` (a Node "browser" project whose spec imports a
  helper that imports the changed source, and whose global setup imports the
  helper and writes a marker and a `TEST_ENV_*` line to stdout), then runs the
  packaged `squeal code --base HEAD --json` per case. Default runtime: the
  installed 0.1.427. Each case is skipped while the one-minute load is above
  24, and records the load beside its time. Outputs: `<case>.out.json` when a
  case ran. See `../../selection.md` for which cases ran.
