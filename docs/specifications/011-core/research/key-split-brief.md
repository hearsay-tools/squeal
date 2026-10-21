# Research brief 011-81: what splits a whole suite's keys between worktrees

Use /researcher. Shape: research. Outcome: name the key part that differs between worktrees whose test files mostly match, show how often it re-keys a whole suite and what that costs, and recommend the narrowest key input that keeps its guarantee.

## Why

`host-load.md` 3, item 3: on 2026-10-21 three squeal worktrees shared 0% of their keys with any live worktree, while two on the same version shared 99%. All five had the same `vitest.config.ts` and `squeal.config.json`; their installed lockfiles differed, and `node_modules/.package-lock.json` records the root package's version. Cezar `f1ca49e6` shared 1% with `7c144ff7` on the same base, though its changes reach no unit test's closure. Only an input in every key of a project can do that. If it is the project's own version, every version raise re-runs the whole squeal suite in every worktree, several times a day. The human (2026-10-21) asked for this research after the host-load review.

## Read first

`host-load.md`; `src/core/keys/environment.ts` (`environmentHash`, `installedDependencies`, `staleHiddenLockfile`), `dependencies.ts` (`scopedDependencies`, `isOpaque`), `check-key.ts`, `hidden-lockfile.ts`, `packages.ts`; how the Vitest adapter builds `RunnerPackages` (`src/runners/vitest/packages.ts`); 011 C3 (with its key-format text) and C11; `research/key-format-guard.md` (a different cause: Squeal's own release, fixed by 011-41).

## Questions

1. **Squeal, a version raise.** Take two commits of this repository that differ only by a version raise (for example the release commits of 0.1.240 and 0.1.242), each cloned and installed with `npm ci`. Which part of a test file's key differs: the environment hash, its installed-dependency input, a per-file dependency key, or something else? Is the package graph usable there, or does `scopedDependencies` fall back to the whole fingerprint, and by which condition?
2. **Squeal, a stale install.** The same with a `package.json` raised but the install left from an older version, as in `04a258b0`. Does `staleHiddenLockfile` fire, and what does the key hold then?
3. **Cezar.** Which key part differs between `f1ca49e6` and `7c144ff7`? Cezar installs with pnpm, so the graph may never be usable there. Read their installed lockfiles and environment inputs from the live worktrees, read-only, or reproduce on clones.
4. **How often and what it costs.** From both stores, read-only: how many whole-project re-keys happened in the 7 days to 2026-10-21, what caused each (version raise, install, environment variable, config), and the run-hours that followed each.
5. **Recommendation.** The narrowest input that still re-keys when an installed dependency changes, for npm and pnpm: for example the lockfile without the root and workspace packages' own versions, whose sources the closures already hold. Name prior art (Vitest's `getLockfileHash`, Nx, Turborepo, Bazel), the regressions the change must pass, and whether it needs a key format raise.

A lead, not a rule: a script that imports the key modules from your worktree with `tsx` and prints each part of `environmentHash` for two roots may be enough. You need no test run.

## Rules

- The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal a process. Reading files in other worktrees is allowed; writing there is not.
- Clone under `/tmp` (`git clone`, never `git worktree add`: a worktree of a live repository shares its live store). Install offline from the host's npm and pnpm caches. A scratch daemon, if you need one, runs with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`, with `baseline.onStart: lookup-only`, the slow lane off and at most 4 test workers. No build in your worktree.
- Run no test suite. The host is loaded; record the one-minute load beside any timing.
- At the end, stop anything you started, remove your clones, and show that nothing of them is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Budget about two hours.

Own `research/key-split.md` and `research/probes/key-split/` only. Edit no board, spec, status, test or product file.

Done when every numbered question has a tagged answer or "not determined, because", and the recommendation names the input, its regressions and its expected effect on the 2026-10-21 population (how many worktrees would then share). Commit.
