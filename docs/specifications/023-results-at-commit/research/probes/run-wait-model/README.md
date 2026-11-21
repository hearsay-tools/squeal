# run-wait-model probes: throwaway

Throwaway scripts for `../../run-wait-model.md` (row 023-37). Not product code; do not import them.

They ran on 2026-11-21 between about 15:16Z and 15:26Z on this host (16 CPUs by `nproc`), at a one-minute load of 14.5 to 19.0 from other sessions; no load was made on purpose. Squeal 0.1.586 as installed.

- Squeal: a detached `git worktree add` of the real repository at `7591bf996` under `$TMPDIR/rw`, so its daemon shared the real store (as a commit worktree would). Warm and cold installs used `../temp-checkout/measure-install.sh` (cold = empty `--store-dir` and `XDG_CACHE_HOME`).
- squawk: `git clone --no-checkout` of `~/projects/cezar` (read only on the original) under `$TMPDIR/rw`, worktree at `c11e4edf0`; its store was empty.
- `daemon-cost.sh <worktree> <group> <test file>`: `squeal start`, `squeal status --wait 300000` (lookup-only settle), memory (RSS and PSS from `/proc/<pid>/smaps_rollup`, the daemon and its descendants) 30 s idle, one `squeal run <group> <file> --wait`, memory after it and 30 s later, `squeal stop`, then a check that the daemon is gone.

Outputs: `out/install-*.txt`, `out/daemon-squeal.txt`, `out/daemon-cezar-empty-store.txt`.

Cleanup: every daemon was stopped (none left), all four worktrees removed, `git worktree prune`, and `$TMPDIR/rw` (clone, cold stores and caches) deleted. The Squeal worktree's worktree-scoped rows stay in the real store until its prune, as for any removed worktree.
