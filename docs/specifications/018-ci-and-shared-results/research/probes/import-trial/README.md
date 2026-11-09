# import-trial probes (throwaway)

Throwaway material for `research/import-trial.md`. These are not product code or tests. Do not run them against a live store.

- `run-42482427002-excerpt.txt`: the Squeal step of cezarion run 42482427002, with ANSI codes and command echo removed.
- `revision-paths.mjs`: reads a **copy** of a Squeal store (`storecopy/store.sqlite`) read-only. It lists every path in `revisions.changes` that `bed82fdb` does not track (`tracked.txt` = `git ls-files`), with counts per worktree. Run it from the directory that holds both files: `node revision-paths.mjs`. Then `git check-ignore --stdin` split the output into ignored and not ignored paths.
- `step0.sh`: the commands of the Step 0 reproduction, as run by hand in a fresh clone under `$TMPDIR`.
- `per-project.ts`: per Vitest project, Squeal 0.1.419's own `readImports` counts and each project's files by class and origin, for one clone. Run it from a `git archive squeal--v0.1.419 src package.json tsconfig.json` tree with this repository's `node_modules` linked: `node_modules/.bin/tsx per-project.ts <clone>`. It opens the store through `openStore`, which runs migrations, so use it only on a throwaway clone's store, never on a live one.
- `classify.mjs <fresh store> <shared store>`: for each test file whose key differs between the two clones, it sorts the closure paths that one store has and the other lacks into kinds (read-only).
- `obs.mjs`: for one test file, whether the extra closure paths of the shared store are in that store's observed sets or in CI's (read-only; paths of the deleted clones are hard-coded).
- `run-42530503204-excerpt.txt`, `run-42596322864-excerpt.txt`: the Squeal step of the second and third trial runs.
- `counts/`: the outputs of counts 1 and 2. `c1-*` is count 1 (import, then start); `c2a-*` and `c2-before-import-*` are count 2 before the import, `c2b-*` and `c2-after-import-*` after it. `*-status-full.json` is `squeal status --full --json`, `*-per-project.json` is `per-project.ts`, and `*-import.txt` is `squeal import`'s output.
