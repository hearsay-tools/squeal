# 017-17 to 017-20: ESLint worker repairs from dogfood 017-13

Worker 4b6522b5, 2026-11-01. Wave 4 W1 (`../wave-4.md`), shape repair. The rows and their done-when are `../../lessons.md` Round 1, Proposed rows L3, L4, L1 and L2. This one file covers the four rows. Commits on `cez/4b6522b5`, base `a64a454f9`:

| Row | Commit | Test |
| --- | --- | --- |
| 017-17 (L3) | `4dbf30061` | `test/lint/provider/cwd.test.ts` |
| 017-18 (L4) | `aa6bd243f` | `test/lint/provider/program-build.test.ts` |
| 017-19 (L1) | `efe43762a` | `test/lint/integration/pnpm-shim.test.ts`, `test/lint/provider/pnpm.test.ts` |
| 017-20 (L2) | `afd63024c` | `test/lint/integration/install.test.ts`, `test/lint/provider/install.test.ts` |

Each test was red before its fix, for the reason the row names, and is green after it.

## 017-17: the worker's process directory

- `worker.ts` sets `process.cwd = () => realpathSync(root)` before the observer and ESLint load. A worker's `process` is its own, so this does not touch the daemon's thread. `path.resolve`, and every library that calls `process.cwd()`, now see the root.
- A relative path given to `fs` still opens against the thread's real directory, the daemon's. The observer's `absolute()` resolves through `path.resolve`, so after the patch it named `<root>/x` while the open read `<daemon dir>/x`. `wraps.ts` now passes a relative path to the wrapped reads (`readFileSync`, `readFile`, `promises.readFile`) and opens (`openSync`, `open`, `promises.open`, `createReadStream`, `openAsBlob`) resolved against the root. The bytes read and the bytes hashed are then the same file.
- `PROVIDER_VERSION` 5. `test/lint/provider/provider.test.ts` asserts it.
- The test fixture has two rules: one reads `tsconfig.base.json` through `path.resolve`, as `eslint-import-resolver-typescript`'s `project` does, and one through a bare relative `readFileSync`. Both give the CLI's findings, run from the root, while the test process's directory is elsewhere.
- **Limit.** Other relative `fs` calls (`existsSync`, `statSync`, `readdirSync`, and so on), child processes and native code still resolve against the daemon's directory. No plugin in the dogfood did this. A wider fix wraps every path-taking `fs` function.

## 017-18: a cold typed worker

- Protocol: `FromWorker` gains `{ type: "building", id, what }`. The worker sends it before a step that may build a program. The thread then guards that step with the call's start budget. The next `progress` gives D3's guard back.
- `LintThread.call(message, guardMs, startMs = guardMs)`. A timeout in the start budget reads `timed out after 60 s building TypeScript's program for src/t.ts`. D3's guard still reads `timed out after 5 s`.
- `EslintSession.lint` tells a parse as a build when the thread has parsed no typed file yet, or when the file is outside the known program (it may be another program). When one typed file is linted alone in a cold thread, it is now parsed before its lint, so the build is its own step. A warm thread does as before.
- The start budget is `loadGuardMs`. It guarded `open` and `refresh` before; now it also guards builds in `lint` and `inputs`. Its default moves from 30 s to 60 s, the lessons' example. See the decisions.
- The test sleeps 2 s, with `Atomics.wait`, so with no CPU load, on each read of TypeScript's `lib.es5.d.ts`, in a test worker entry (`slow-program-worker.ts`). The guard is 1 s, standing for D3's 5 s. Three cases: a cold lone typed file, then two, give the CLI's results; a hazard rule that blocks after the build times out at 1 s, not at the start budget; a build longer than the start budget reads the build's timeout.
- **Limit.** One "program built" flag per thread. A file in the known program whose project TypeScript has not built yet, for example a second tsconfig under `projectService`, still builds inside its lint, under the 5 s guard. Svelte's case, one cold program, is covered.

## 017-19: a config that loads only through pnpm's shim

- New `provider/pnpm.ts`. `pnpmShimPaths(root)` finds the `node_modules` Node takes ESLint from, walking up from the root. When `node_modules/.pnpm/node_modules` exists there, it returns the shim's `NODE_PATH` folders, in the shim's order: `<.pnpm/eslint@…/node_modules/eslint>/node_modules`, `<.pnpm/eslint@…/node_modules>`, `<node_modules>/.pnpm/node_modules`. The first two come only when `node_modules/eslint` is a link into `.pnpm`. `useNodePath` puts them before any `NODE_PATH` the worker has, as the shim does, and calls `Module._initPaths()`. `EslintSession.open` calls both after the version check, before ESLint loads.
- `NODE_PATH` reaches CommonJS `require` only. An ES module config that imports an undeclared package fails under the shim too, so Squeal and the CLI agree there.
- The integration test copies this repository's own pnpm shim (`node_modules/.bin/eslint`) into a pnpm-style layout under a fake worktree, and runs the real `pnpm exec eslint` there with only `PATH` in its environment. It also checks that plain `node node_modules/eslint/bin/eslint.js` fails on that layout, as the worker did.
- **Not done: "status names the folder".** The proposal said status should name the folder. Status text is in the surface (`src/core/lint/surface/`), outside this row's files, and the declaration type is the pass's (`pass/provider.ts`). The done-when does not ask for it. A later row can add a declaration field and a status line.

## 017-20: no retry after the missing package is installed

The cause was in three places:

1. The kept thread keeps a failed config load. Inferred, not measured: Node keeps the failed module under the config's URL, and ESLint adds the file's mtime to that URL, so a new `ESLint` instance on an unchanged config file fails again. A new thread loads it again (measured: the integration test).
2. The installed lockfile is git-ignored, so no revision names it.
3. A pass whose config does not load writes no keying cursor (`rekey.ts`, `failKeying`). The next pass then takes `since = latest` (`run.ts`) and gives the session no changed paths. So when the config has never loaded, as in saas, no rule in `refresh.ts` sees the install.

The fix uses the pass's existing rule that a closure file the worker holds at other bytes refreshes at D4's level:

- While the root config does not load, `EslintSession.refreshed` holds the root's `package.json` and tracked lockfiles at their bytes (`Observer.hold`, a new `install` slot) and puts them in the closure. An install changes one, the pass sees a closure file at other bytes, and `refreshLevel` gives `thread`. The session reads the install fingerprint again at a thread refresh. This works with a cursor and without one.
- When the config loads again in a thread where it failed, for example after a syntax fix and an `instance` refresh, the refresh answers `moved`. The provider then starts a new thread, which holds none of those files, so they do not stay in every key.
- `refresh.ts`: `isInstall(path)` is a tracked lockfile at any depth (`pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, `bun.lockb`), or the installed lockfile as before. It gives `thread` always, not only after a failed load. This is D4's install row: before, only the git-ignored installed lockfile triggered it. `mayTurnOn` also takes them. `package.json` alone is not an install: it gives `thread` only while the closure holds it.
- The file names are in the new `provider/install.ts`, which has no imports, so the worker's bundle stays free of `keys/environment.ts`. `refresh.ts` imports `TRACKED_LOCKFILES` from it. This is the first value the pass imports from `provider/`.
- **Limits.** A nested config that does not load, while the root config loads, holds no install files. A manifest or lockfile that did not exist at the failure is not held, so creating it later is not seen. An install that changes only `node_modules`, for example `pnpm install` after a checkout, is still not seen. That was true before this row.

## Decisions the spec did not settle

1. **Start budget 60 s, one option.** `loadGuardMs` is the start budget for `open`, `refresh` and builds, with a default of 60 s, up from 30 s. A config that hangs while it loads is now declared failed after 60 s. A separate option for builds would be a second name for the same budget.
2. **Tracked lockfiles always restart the worker.** The lessons' proposal limited this to "after a pass whose config did not load". A lockfile change is an install, and D4 asks for a new thread on an install: the kept thread runs the old plugin code. The cost is one worker start, plus a cold typed program, per lockfile change. A `package.json`-only edit restarts the worker only while the config does not load.
3. **Relative `fs` reads and opens go to the root** (017-17), beyond the proposal's `process.cwd`. Without this, the observer named one file and the read took another.
4. **One notes file** for the four rows, here under `017-17/`.

## Type changes

All are additive, or internal to the provider:

- `protocol.ts`: `FromWorker` gains `building`. New `Steps` interface (`progress`, `building`). `PROVIDER_VERSION` 5.
- `thread.ts`: `LintThread.call` takes an optional `startMs`.
- `session.ts`: `EslintSession.inputs` and `lint` take `Steps` in place of `progress: () => void`. Only `worker.ts` calls them.
- `observe.ts`: `Observer.hold(file, bytes)`, and the `install` slot.
- `eslint-provider.ts`: `EslintProviderOptions.loadGuardMs` now also covers builds, with a default of 60 s.
- `pass/refresh.ts`: new export `isInstall`.
- New modules: `provider/pnpm.ts`, `provider/install.ts`.
- No change to `pass/provider.ts`, the pass's provider interface.

## For the coordinator and the next worker

- **Bundles drift.** `plugins/*/dist/cli/lint-worker.mjs` no longer matches the sources. `test/harness/pi/package.test.ts` fails on it, and so will the other bundle tests until `pnpm run build` runs. The brief said not to build here.
- **Spec amendments to make:**
  - D3: the worker's `process.cwd()` is the root, and relative reads go there. The worker sets pnpm's shim folders on `NODE_PATH`. A build has the start budget, and the 5 s guard starts after it.
  - D4: a tracked lockfile is an install. While the config does not load, the root's manifest and lockfiles are closure inputs.
  - D5: `PROVIDER_VERSION` 5.
  - D9: the timeout reason may name a build.
- **File sizes.** `session.ts` is 483 lines; it was 440 before this row, already over the 300-line guide. A split candidate: the discovery and `open` (with `pnpm.ts`), and the typed-program part (`typedTsconfigs`, `parse`, `learn`, `builds`).
- **Seams.**
  - The guard: `thread.ts` `heard`, and `pending.startMs`.
  - Build steps: `session.ts` `lint`, the feeding loop.
  - Install files: `session.ts` `refreshed` and `holdInstalls`; then the pass's `held.ts` `disagreement` (closure path, so `loaded`), `refresh.ts` `refreshOf` and `refreshLevel`, and `pass/session.ts` `#refresh` (the install fingerprint is read again at `thread`).
  - The cursor gap: `run.ts` `since`, and `rekey.ts` `failKeying`.
- **Test entries.** `workerScript(entry)` in `test/lint/provider/helpers.ts` bundles a test's own worker entry. `slow-program-worker.ts` wraps `fs.readFileSync` before it imports the worker, so the observer wraps that wrapper and still names the real reader.
