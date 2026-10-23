# 011-36: a cached ignored path nothing names stops being watched, worker notes (2026-10-23)

Brief `brief.md`, shape slice. Base `266a3471a`. Commits:

- `b130273ab`: the change in `src/core/scheduler/keying.ts` and `test/scheduler/ignored-leftovers.test.ts`.
- `9a5097481`: the end-to-end case in `test/scheduler/scratch-inputs.test.ts` and this file.
- `49a29dd7f`: the validity case, outside the brief's ownership, approved by the coordinator (decision 1).
- `022dad752`: `test/integration/touched-scope.test.ts`, outside the brief's ownership, approved by the coordinator (decision 2, option A).
- The last commit: this file's update.

## What landed

- `Keys.bootstrap` still watches every cached gitignored path a declaration does not select as an extra file. Each one is now also **inherited** (`#inherited`, formerly `#revived`): a path the store named, not this daemon's runner. A dropped path a closure tracks again is inherited too, as before.
- `#release` judges inherited paths, still only from `trackUntracked`. An inherited path that no closure (reverse index), environment file, former environment file, lockfile or observed read names is dropped from the stat cache and the store, leaves the extra files, and `onExtraFiles` gets the shorter list. The drop makes no revision.
- No path is judged before the first environment read (`#environmentsRead`). Before it the lockfile paths are not known, so the installed lockfile would be dropped while the environment fails.
- A kept path is judged again only when what named it can have changed (`#unjudged`): `setClosure` replaces a closure that named it, `removeTestFile` removes a known test file, or `setEnvironments` reads the environments again. So a release costs nothing while nothing changed.
- No type changed. No exported name changed.

## Seam map

- Order at daemon start (`src/core/scheduler/bootstrap.ts`): `scan` calls `keys.bootstrap`. `baseline` calls `readEnvironments` (`setEnvironments`), then `setClosure` with each listed file's saved closure, then `resolveClosures` for files with no saved closure, which ends in `trackUntracked`, so in the first `#release`. A miss is resolved again by the runner, and its `trackUntracked` judges what the miss's saved closure named.
- A removed project's test files are not listed, so `baseline` never sets their saved closures. Their rows in `test_file_keys` go through `ledger.removeFile`, which calls `keys.removeTestFile`, and the index never knew them. Only a failed listing sets them (`refs` falls back to `previousKeys`). Then they keep their paths named until a later listing removes them, and that `removeTestFile` judges every inherited path again.
- While the daemon waits for an install, `reconcileWaiting` does not call `trackUntracked`, so no path is judged before the baseline.
- The change feed starts after `scheduler.start()` with `scheduler.extraFiles()` (`src/core/daemon-loop/index.ts`), so a path the baseline dropped is never watched by the new daemon. Later drops reach `ChangeFeed.setExtraFiles` through `onExtraFiles`.
- The start reconciliation still re-stats every cached path once, the leftovers included, before anything is judged. A leftover rewritten while no daemon ran is in that start revision. It reaches no test file.

## Decisions the brief did not settle

1. **When a kept path is judged again.** The brief's lead puts bootstrap's extras in the `#revived` set, which `#release` judged in full at every `trackUntracked`, so every refinement. Bootstrap's extras are common: the installed lockfile in almost every worktree, and generated code a closure names. In full each time, a release reads every test file's observed set (sorted per call) and one sorted reverse lookup per kept path. With about 1,000 test files that is every refinement. My choice: judge each path once, then only after a change that can unname it. A saved closure is replaced only through `setClosure`, so S1's case (`reviews/wave-5.6.md`) still drops at the miss's runner closure.
2. **Former environment files count as named.** `#release` before this row did not count `RunnerEnvironment.formerFiles`. A gitignored former file would be dropped after each environment read and hashed again at the next. They are named now.
3. **No judgement before the first environment read**, as above. Before this row a revived path could be dropped before it; in the baseline the read comes first, so this changes only a start whose environment read fails.

## Tests

- `test/scheduler/ignored-leftovers.test.ts`, new, over `WorktreeKeys` and a seeded stat cache, no runner, about 3 s. Five cases: the drop with no revision while a closure-named, an observed and a lockfile path stay; nothing judged before the environment read; a replaced closure; a removed test file; a dropped path named again is tracked and watched again. All five failed at `266a3471a`.
- `test/scheduler/scratch-inputs.test.ts`, one new case, real Vitest and node:test: a node:test project imports a gitignored `pkg/dist/lib.js`, a predecessor's row holds `pkg/dist/lib.d.ts`, the project is removed, and one daemon start drops both while `src/gen/client.ts` (named by `test/gen.test.ts`) stays. A rebuild makes no revision. It fails at `266a3471a`'s `keying.ts` with `expected [ 'pkg/dist/lib.d.ts', …(2) ] to not include 'pkg/dist/lib.js'`.

## Outside the brief's ownership, approved by the coordinator

1. **The `KEY_FORMAT_VERSION` alarm** (`test/keys/key-format.test.ts`) failed at `b130273ab`: "changed lines no case runs". No case seeded a stat cache, read environments through `setEnvironments` or removed a test file. `AssembleInput` (`test/keys/validity/case.ts`) gains three optional fields: `cached`, `environment` and `after`. `harness/assemble.ts` applies them only when they are present, so no existing case changes. The new case is `cases/assemble/inherited.ts`. Every key agrees at both trees, so no raise. The flagged lines it runs:
   - At the release (`squeal--v0.1.273`, the newest tag below this branch; the line numbers are `266a3471a`'s `keying.ts`): 174 (bootstrap's `else this.#extra.add(path)`), 413 (`removeTestFile`), 454 and 459 (`#release` filtering and dropping a revived path).
   - At the candidate (`b130273ab`'s `keying.ts`): 181 to 184 (bootstrap's ignored branch and `#inherit`), 429 (`removeTestFile`'s rejudge), 461 to 464 (`#inherit`), 469 (`#rejudge`), 481 to 483 (former environment files), 487, 490 and 493 (`#release` judging and dropping).
   - With the case, the alarm passes; without it, it names exactly these lines. `test/keys/validity/bundle.ts` is not touched (row 011-141 owns it).
2. **`test/integration/touched-scope.test.ts` case 1** (013-02, T1 and T2): its rig seeded `dist/unrelated.js` as a cached row nothing names, which is the leftover this row drops at start, so the touch never reached the runner. The rig changed for that reason. A node:test project's test now imports the path (cezar's `test:package` shape), no row is seeded, and the stored expectations read the Vitest files only.

## Draft for spec 011 C2 (the coordinator owns the spec text)

After "Gitignored files that appear in a known closure (generated code) and the installed-dependency lockfile that the environment hash reads are added to the stat cache and watched individually, [...] even though the ignored tree around them is not watched;":

> A gitignored path the stat cache holds from an earlier daemon is watched again at start, and once the environment is read, one that no closure, environment file, lockfile or observed read names is dropped from the stat cache and no longer watched, without a revision; a kept one is judged again when a closure that named it is replaced or its test file removed, or the environment is read again, and a path named after its drop is hashed and watched again (amended 2026-10-23, row 011-36).

## For the next worker

- The bundles are not rebuilt (brief: no `npm run build`). `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail with `cli/squeal.mjs differs from the build` until the coordinator rebuilds at integration.
- A path `track` adds during a daemon's life is not inherited, so it stays watched until the next start even when its closure stops naming it. The next start judges it. This matches the row's "after one daemon start".
