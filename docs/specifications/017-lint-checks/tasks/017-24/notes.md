# 017-24 and 017-27: ESLint worker repairs, wave 5 W2

Worker 52f2079c, 2026-11-02. Wave 5 W2 (`../wave-5.md`), shape repair. Rows on the board; `../../lessons.md` L7; `../../reviews/0.1.391.md` N1. This one file covers both rows. Commits on `cez/52f2079c`, base `55a9aaa61`:

| Row | Commit | Tests |
| --- | --- | --- |
| 017-27 (N1) | `2c027c06b` | `test/lint/provider/cwd.test.ts` (second case), `test/lint/provider/rooted.test.ts` |
| 017-24 (L7) | `ca8568305` | `test/lint/provider/nested.test.ts`, `test/lint/provider/lookup.test.ts` |

Each real-ESLint test was red before its fix, for the reason the row names, and is green after it.

## 017-27: every relative `fs` call runs from the root

- New `provider/rooted.ts`, the one owner of the redirection. `runFromRoot(root)` sets `process.cwd()` to the root's real path (moved from `worker.ts`), then wraps every `fs` function that takes a path: the callback, `Sync` and `fs.promises` forms. A relative path argument is resolved against the root before the system call. `syncBuiltinESMExports()` then gives ES module imports the wrapped functions.
- `PATH_ARGUMENTS` is the table: each function's path arguments by index. `copyFile`, `cp`, `link` and `rename` root both paths. `symlink` roots only the link path: the system reads a relative target from the link's folder.
- `wraps.ts` lost `rooted` and `rootedArgs`. The observer's reads and opens pass the caller's path on, to the rooted function below them. `absolute()` names the same file, since `path.resolve` reads the patched `process.cwd()`.
- **Order matters.** `runFromRoot` runs before `Observer.install`, so the rooting is the inner layer. If it were the outer layer, `callerOf` would name the worker's own wrapper as the reader.
- A function's own function properties are wrapped too: `realpathSync.native`, `realpath.native`, and `exists`'s promisified form. `fs.promises.opendir` names itself as its promisified form; a map of wrapped functions closes that cycle (without it, the worker's stack overflowed at start).
- **Red test.** A rule plugin uses TypeScript's own `findConfigFile`, `readConfigFile` and `parseJsonConfigFileContent` with relative paths, as a resolver does. A second rule calls `existsSync`, `statSync` and `readdirSync` on the file's folder. Before the fix the worker reported `No tsconfig.lint.json above src/a.js.`, since `statSync` looked in the daemon's directory. After it, both rules give the CLI's findings.
- **Table test.** `rooted.test.ts` reads each `fs` function's parameter names from Node's own source. Every parameter Node names as a path (`path`, `p`, `filename`, `prefix`, `src`, `dest`, `existingPath`, `oldPath`, `newPath`) must be in `PATH_ARGUMENTS`. A path function a later Node adds fails it.

## 017-24: ESLint 9 with nested configs

- New `provider/lookup.ts`. `EslintSession.made()` makes every `ESLint`, at open and at each `instance` refresh. With ESLint 9 and a nested flat config, it sets `ESLINT_FLAGS` to the daemon's flags plus `v10_config_lookup_from_file` before ESLint is made. ESLint 9.39 reads the variable in its constructor (`createLinter`, `mergeEnvironmentFlags`). Without a nested config, or with ESLint 10, the variable stays the daemon's.
- `KEYED_ENV` gains `ESLINT_FLAGS`. `environment()` reads it when it is called, so the key holds the flags in use. D5's env part moves every key (`test/lint/pass/keys.test.ts`, the `env` case).
- A nested config added or removed is a flat config change. `pass/refresh.ts` already gives `instance` for it, at any depth. The new instance walks the folders again and sets the flag. No new refresh level.
- The nested config joins the closure when ESLint first loads it, with the first file under it. Before that, the closure has only the root config. This is as under ESLint 10.
- **Red test.** `nested.test.ts`, real ESLint 9.39.5: a file under `packages/app/eslint.config.js` gives `no-console` (the nested config), as ESLint 10's CLI and ESLint 9's CLI with the flag give. Before the fix it gave `no-debugger` (the root config).
- **The ESLint 9 replay's reference moved.** The 200-edit schedule adds `src/eslint.config.js` at step 181 and removes it at step 187. The worker then used it and gave ESLint 10's recorded results, so steps 181 to 186 failed against the ESLint 9 recording, which a CLI without the flag made. `replay.ts` now runs ESLint 9's reference CLI with `ESLINT_FLAGS=v10_config_lookup_from_file` only while that nested config exists (`schedule.ts` exports its path as `NESTED_CONFIG`). `test/fixtures/lint/replay-eslint9.json` is re-recorded, in a commit of its own, by the coordinator's agreement (option A). The ESLint 10 recording does not change.

## Decisions the spec did not settle

1. **"In the listing" is a folder walk.** The worker does not get the listing: no message carries it, and the pass's `LintProvider` interface is not this row's. `hasNestedConfig` walks the root, skipping `node_modules` and folders whose names start with a dot, as `findTsconfigs` does. It stops at the first nested config. A config in a git-ignored folder, as `dist/`, also turns the flag on. Then every key moves. I expect the listed files' findings to stay the same, since each still uses the root config, but I did not measure it. The walk runs only for ESLint 9, at open and at each `instance` refresh.
2. **An older ESLint 9 keeps the daemon's flags.** An ESLint 9 that refuses `v10_config_lookup_from_file` as unknown, or one that does not read `ESLINT_FLAGS`, is made again without the flag. Its nested configs stay unused, with no status line. I did not use version numbers, because I do not know which 9.x release added each feature. `lookup.test.ts` covers this with a fake, because no older ESLint 9 is installed here.
3. **The daemon's own `ESLINT_FLAGS` is keyed**, with or without nested configs, as D5 lists. A user who sets it re-keys every file once.
4. **`PROVIDER_VERSION` stays 5.** 017-27 changes results only for plugins whose relative probes found nothing in the daemon's directory. Version 5 came with 017-17 in 0.1.391, which is not released (the last release is 0.1.390), so both rows ship under 5. If 0.1.391 is released before these rows land, raise it to 6 for 017-27. 017-24 moves keys through the env, so it needs no raise.
5. **Writes are rooted too.** `mkdir`, `writeFile`, `rm` and the others take a relative path from the root, as the CLI does. The observer does not track writes.
6. **Paths resolve lexically,** with `path.resolve`, as 017-17 did. The observer's name for a file and the file read stay the same. Two kept details: a trailing separator stays, so `existsSync("a.js/")` stays false for a file; and an empty path stays empty, so Node gives its own error.
7. **Child processes are not redirected.** A `spawn` or `exec` with no `cwd` still starts in the daemon's directory. The brief names file-system calls. D5's accepted boundary 4 already leaves reads in a child process unobserved. A later row can default `cwd` to the root in `rooted.ts`.
8. **One notes file** for the two rows, here under `017-24/`.

## Type changes

All are new, or internal to the provider:

- New `provider/rooted.ts`: `PATH_ARGUMENTS`, `runFromRoot`, `rootedPath`.
- New `provider/lookup.ts`: `LOOKUP_FLAG`, `DAEMON_FLAGS`, `hasNestedConfig`, `withFlag`, `lookupEslint`.
- `session.ts`: the local `Eslint` interface gains an optional `hasFlag`, and a private `made()`.
- `wraps.ts`: the private `rooted` and `rootedArgs` are gone. Nothing exported changed.
- No change to `pass/provider.ts`, `protocol.ts` or `PROVIDER_VERSION`.

## For the coordinator and the next worker

- **Bundles drift.** `plugins/*/dist/cli/lint-worker.mjs` no longer matches the sources. `test/harness/plugin.test.ts` ("are committed exactly as `npm run build` produces them") fails on it until `pnpm run build` runs. The brief said not to build here.
- **Spec amendments to make:**
  - D3 step 2: every relative path an `fs` function takes resolves against the root (row 017-27); child processes do not.
  - D3 step 4: "in the listing" is a walk of the project's folders, without `node_modules` and dot folders, at open and at each `instance` refresh. An ESLint 9 that does not take the flag keeps the daemon's flags.
  - D5: `ESLINT_FLAGS` is keyed as the worker sets it.
- **One regular expression in two places.** `lookup.ts` has its own copy of `pass/refresh.ts` `isFlatConfig`'s pattern. The worker cannot import `refresh.ts`: it would bring `keys/environment.ts` into the worker's bundle. A module with no imports, as `provider/install.ts` is for lockfiles, could hold it for both. `refresh.ts` is not this row's.
- **File sizes.** `session.ts` is 491 lines (483 before). The split candidates in `../017-17/notes.md` still apply.
- **Seams.**
  - Redirection: `rooted.ts` `runFromRoot`, called in `worker.ts` before `Observer.install`.
  - Flags: `session.ts` `made()`, then `lookup.ts` `lookupEslint`; `environment()` reads `KEYED_ENV` when it is called.
  - The `instance` refresh for a nested config: `pass/refresh.ts` `refreshLevel`, then `session.ts` `fresh()`.
