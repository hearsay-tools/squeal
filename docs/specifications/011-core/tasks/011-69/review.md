# Review of cand/0.1.241 (011-69)

Use /reviewer. Shape: review. Pinned to the `cand/0.1.241` SHA named in the spawn; the range is `origin/main..<sha>`: 011-69's two commits (`feat(daemon)`) and the release commit (0.1.241, bundles; no key-format or `RECORDER_VERSION` change).

Read `brief.md` beside this file (the contract), `../../research/daemon-memory.md` 2 and 4, and 011 C9. Check that:
- the GC runs once after 60 s with no tier in any lane, never while a tier runs, and not again until a tier has run and ended; work queued and waiting for a slot or for load counts as idle; every lane's run, the slow lane's and node:test's and pytest's slots included, passes through `IdleGc.track`;
- it never runs while the daemon is stopping, and an error in it cannot stop the check loop or the daemon;
- `exposeGc` sets `--no-expose-gc` again in every path, so Vitest's worker threads and later vm contexts get no `gc`, and a global `gc` from `--expose-gc` is used as is;
- a missing or throwing `gc` gives one note, and no retry loop;
- the memory test proves the last-resort flavor, not a plain GC, and is skipped where `/proc` is absent; the daemon test does not depend on host load or timing;
- the version is raised in all eight places and the bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. `test/e2e/shipped-plugin.test.ts` fails on this host since 2026-10-21 15:00 UTC on main too (row 014-17, host state): name it, and treat it as a blocker only if you trace it to this range. A file that fails loaded and passes alone is named. Write `../../reviews/0.1.241.md` with a PASS or FAIL verdict and commit it.
