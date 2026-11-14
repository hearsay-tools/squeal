# Probes for `selection-option.md` (row 022-02)

Throwaway. Nothing here is product code or a test. Delete freely.

## What they read

Copies of two Squeal stores, made 2026-11-14 12:00Z with `VACUUM INTO` through a read-only `node:sqlite` connection into `$TMPDIR` (copies deleted after the run):

- this repository: `~/projects/squeal/.git/squeal/{store,code}.sqlite`, config `squeal.config.json` at `2856d26e8`;
- cezar: `~/projects/cezar/.git/squeal/{store,code}.sqlite`, config `squeal.config.json` at cezar `origin/main` `4711d29b3`.

No test, daemon or build ran. One-minute load during the runs: 13 to 15 on 24 CPUs; no timing is reported.

## Scripts

- `loaded-vs-closure.mts <store> <code> <squeal.config.json> <label>`: per test file, the stored closure list (`test_files.closure_paths`, the static closure plus declared inputs and observed reads) against the paths in the test file's newest coverage record (`code.sqlite` `coverage` at the newest result key that has one; a manifest's `unread` lists every path). It classifies each closure path missing from the record: the test file itself, under `coverage.exclude`, a declared input, an observed read (`meta` `observed.*`, `observedModules.*`, `observedDirect.*`), a `.snap`, a non-JS/TS file, or else "code module, not loaded". A file is "narrowed" when at least one closure path is a code module that the record lacks. Output: `squeal-summary.json`, `cezar-summary.json`.
- `extra-paths.mts <store> <code>`: the paths most often in a record but not in the stored closure.

Run from this folder with the worktree's `node_modules/.bin/tsx` (it imports `src/core/keys/glob.ts`).

## Caveats

- The stored closure is the newest writer's list for `(project, path)`, from any worktree. The newest coverage record can be from another revision. The two are not from one run. In this repository, `src/cli/wait/*.ts` shows in 107 to 135 records but in no stored closure. These are probably newer modules, which shows the skew.
- Coverage records leave out `coverage.exclude` paths: this repository's `test/**` helpers and cezar's mock scripts. Such a path counts as "kept", never as "narrowed", because the record cannot tell whether it loaded.

## extra-paths output (top lines)

cezar: `scripts/check-workspace-resolution.mjs`, `scripts/test-home-setup.mjs`, `scripts/test-sandbox.mjs` (1,299 server files each), `packages/cezar/vitest.setup.ts` (1,296), `packages/web/vitest.setup.ts` (393). These are setup files and their imports. Squeal hashes them into the environment hash, not into a closure list.

squeal: `src/cli/wait/{synced,edit-window,listing,named,...}.ts` (107 to 135 files each). See the caveat above.
