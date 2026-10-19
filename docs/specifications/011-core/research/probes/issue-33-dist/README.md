# Issue 33 dist probe (throwaway)

Throwaway evidence for `../../issue-33-dist.md`; delete freely. Not product code, not a test.

- `build-twice.sh <cezar-checkout> <sha>`: `git archive` of the SHA into a fresh `/tmp` dir
  (the checkout and its `.git` are only read), `node_modules` symlinked, `tsc` twice in
  `packages/cezar`, then bytes, mtimes and inodes of `dist` compared. `HOME` stays in `/tmp`.
- `touch-probe.sh <probe-dir> <label> <path> touch|rewrite-same` and
  `touch-twice.sh <probe-dir> <path>`: the `../issue-33/fixture` repo rebuilt under `/tmp`
  (strip `.txt`, rename `dist-ignored-in-probe` to `dist`, `gitignore` to `.gitignore`, symlink a
  `node_modules` with Vitest 4.1.x), `HOME` and `XDG_*` inside `<probe-dir>/home`, Squeal run as
  `SQUEAL_CLI=<plugin>/dist/cli/squeal.mjs`. Start it with `squeal init`, `squeal start`,
  `squeal run --all --wait`, under that `HOME`.
- `runlog.cjs <probe-dir> <min-revision>`: each stored run's files, completed, withheld, failure.
- `cezar-store-dist.cjs <store.sqlite>` and `cezar-store-reported.cjs <store.sqlite> <names...>`:
  read a **copy** of cezar's `.git/squeal/store.sqlite` (copied to `/tmp` with its `-wal`),
  opened read-only: which `dist` paths each worktree's stat cache holds, and which closures
  name `packages/cezar/dist/`.

Never point `HOME` at the real one, never open the live cezar store.
