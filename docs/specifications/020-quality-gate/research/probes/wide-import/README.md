# Row 020-17 (gh-175 study) probes: throwaway

Research evidence for `../../wide-import.md`, not product tests. Nothing here
is imported by Squeal or run by its suites. No probe writes in
`~/projects/cezar`. Scratch lives under `/tmp/wide-import/`.

- `cezar-store.mjs <store.sqlite> <durations.json> <W> <changed,...>`: reads
  cezar's Squeal store read-only (`?immutable=1`) and cezar's CI duration
  manifest. It gives the selection by stored closure, by project and group,
  the loader set size of each changed path, and per-file costs. The store is
  live, so a read can fail with "malformed": retry it. Output (the per-file
  list removed): `cezar-store.out.json`. Run 2026-11-11 11:53Z for cezar
  `7e0883a43` against its parent `1b5939ba0`, with the manifest from
  `git show 7e0883a43:.github/test-durations.json`.
- `simulate.mjs <cezar-store.json> <W> <store|manifest>`: list scheduling
  over that output, with no store read. It compares today's path order with
  loader order, for budgets of 600 and 1,500 s, with and without the browser
  group. The browser files run one at a time after the rest, as Vitest 4.1.10
  `groupSpecs` puts them. Outputs: `sim-W<W>-<cost>.out.json`. This is a model,
  not a run.
- `fixture.mjs <dir> <N> [K S L SLEEP]`: a synthetic hub repository. A hub
  of K functions is imported by every one of N test files. S side files are
  loaded by L files each, spread over the path order. Two commits: the base,
  then an edit of every hub and side function. Its `node_modules` is a symlink
  to this worktree's.
- `probe.ts <root> <base>` (run with this worktree's `tsx`): runs the
  worktree's own `codeGateCommand`. Every adapter method is timed on one
  timeline. `ORDER=loaders` reorders the files handed to `run` (smallest
  loader set of a changed path first). `TIMEOUT` is the gate's `--timeout`.
  It prints one JSON line.
- `guard.sh <cmd>`: runs `<cmd>` only while the one-minute load is at most
  24. It waits up to 10 minutes, then skips with exit 99.
- `runs.sh`: the live probes in order, each behind `guard.sh`, with `HOME`
  and `TMPDIR` under `/tmp/wide-import/`: the 600-file whole run, the
  ordering pair at about half that budget, cezar's pre-run phases (budget
  1 s, so no file runs). The 1,800-file whole run is kept only as a
  commented command: it needs an approved run. Outputs:
  `/tmp/wide-import/out/<name>.json`, copied here as `<name>.out.json` when a
  probe ran. On 2026-11-11 every step was skipped by the guard (see
  `../../wide-import.md`, "Live probe results").
