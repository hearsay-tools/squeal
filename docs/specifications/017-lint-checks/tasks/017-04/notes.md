# 017-04: notes for the next rows

Worker 2e373245, 2026-10-26. The ESLint provider in its own worker thread, against the wave 1 interface as the coordinator amended it on 2026-10-26 (`refresh(level)`, `lint(files)` without a level, `LintOff`). No daemon wiring: 017-05's pass takes it at integration.

Wave 1.5, row R2 (same day): review `0.1.348` B2 and B3 at the provider, and `PROVIDER_VERSION` 2. See decisions 10 and 11, the B3 cost, and "What the next rows must know".

## Seam map

| File | What it holds |
| --- | --- |
| `src/core/lint/pass/provider.ts` | The interface (the pass's file since integration `c63cd9a61`; the provider's copy is gone). |
| `src/core/lint/provider/eslint-provider.ts` | `eslintProvider({ root, script?, env?, guardMs?, loadGuardMs?, now? })`. Host side: calls one at a time, D4 levels, failure count, `off`. |
| `src/core/lint/provider/thread.ts` | `LintThread`: one `Worker`, its guard (restarted at each progress message), `ThreadFailure` (timed out, threw, exited) and `CallError` (the worker answered an error and lives on). |
| `src/core/lint/provider/worker.ts` | The worker entry, bundled as `cli/lint-worker.mjs`. Installs the observer before ESLint loads; answers `off` when a config load was not seen. |
| `src/core/lint/provider/observe.ts` | `Observer`: a `module.registerHooks` resolve hook records every module the thread resolves; a wrapped `fs.readFileSync` records the files read while a config loads (jiti, B2). |
| `src/core/lint/provider/session.ts` | Worker side: discovery (`eslint/package.json` from the root, `loadESLint`, `cwd` given), `inputs`, `lint` with the program feed, the environment. |
| `src/core/lint/provider/program.ts` | `ProgramReader`: each tsconfig's root files (`getParsedCommandLineOfConfigFile`) and every file their imports resolve to (TypeScript's module resolution), no type check (B3). |
| `src/core/lint/provider/loaded.ts` | Resolved module URLs as project files (`closure`) and package roots (`packages`). |
| `src/core/lint/provider/signals.ts` | D5's whole-program signals from a computed config's JSON. |
| `src/core/lint/provider/protocol.ts` | The messages, `PROVIDER_VERSION` (2 since wave 1.5) and `ROOT_TOKEN` (`<root>`). |
| `src/core/lint/provider/script.ts` | `lintWorkerScript()`: `lint-worker.mjs` beside the bundled CLI, `worker.js` beside tsc's build, `null` from the sources (then `open()` is off). |

## Decisions the spec did not settle

1 to 4 were agreed with the coordinator on 2026-10-26; 5 to 9 are this row's choices; 10 and 11 are the wave 1.5 repair (R2).

1. `inputs()` rejects with an `Error` whose message is D9's reason when the config does not load, the worker fails or the provider is off.
2. The computed config's JSON has the project root (and its real path) written `<root>`. A typed config holds `tsconfigRootDir` as an absolute path on ESLint 9 and 10, so without it no typed file's key is shared between worktrees (goal 7).
3. The third worker failure (timed out, threw, exited) within 10 minutes turns the provider off; that call resolves `{ off: "the ESLint worker failed 3 times; <reason>" }`. `refresh("instance" | "thread")` and `open()` clear the off state and the count. An earlier failure gives every file of that call `unknown` with the reason (D9: the part's files), and the next call starts a new worker. A failure while no call is in hand (a plugin's late timer) counts too.
4. `refresh()` reports `program` and the tsconfigs in `closure` before any lint. A `tsconfig.json` under the root (outside `node_modules` and dot folders) counts when one of its files gets a typed config from `calculateConfigForFile`, which applies ESLint's own `files` and ignores; `project` as paths names its tsconfigs instead. `lint()` adds what it learns (accumulates per thread).
5. `lint()` feeds typed files and the given program files ESLint does not lint to TypeScript's project service, by the config's own parser (`parseForESLint`), before it lints, when the call holds more than one of them; a typed file alone is parsed first only when it is outside the known program, to learn its program. Tested with `projectService`; `project` (typescript-estree's own programs) is not. A fed file ESLint does not lint gets no entry in `results`. A file that is neither linted nor in the program reads `unknown: ESLint does not lint this file`.
6. A file a rule throws on reads `unknown: ESLint failed on this file: <first line>`; the worker lives on. A parse error is a finding with `rule: null` (D9).
7. A plugin's 0 ms timer that throws fails the call it was set in: the worker waits one timer turn before it answers.
8. The worker runs with `execArgv: []`, the daemon's environment plus `TSESTREE_SINGLE_RUN=false`; a plugin's stdout and stderr are read and dropped.
9. Off reasons: `no ESLint installed in <root>`, `ESLint <major> is not supported`, `eslintrc configs are not supported; ESLint 9 and 10 read eslint.config.*` (ESLint 9 with `ESLINT_USE_FLAT_CONFIG=false`), `the ESLint worker's script is not built`, and (B2) `the ESLint worker cannot see which files <config> loads`.
10. **B2, the closure of a TS config.** ESLint 9 and 10 load `eslint.config.ts` with jiti (`createJiti(…, { moduleCache: false })`), which reads each module with `fs.readFileSync` and resolves none through Node, so the resolve hook saw nothing. The worker wraps `fs.readFileSync` and records each absolute path read while `calculateConfigForFile` runs (the only call that loads a config; `configOf` and the refresh probe go through it). Reads at other times (TypeScript reading the program, rules reading files) are not recorded. jiti's file cache is off in the worker (`JITI_FS_CACHE=false`, the worker's own `process.env`): its cache files, in the temp folder, would enter the closure and differ between worktrees. Each config file ESLint uses (`findConfigFile(path)`) joins the closure, the root one and nested ones. When that config file is in neither the resolved modules nor the recorded reads, the worker answers `off` with the reason above, for any call; the host stops the thread and stays off until a refresh above `none`. Node's own type stripping (`ESLINT_FLAGS=unstable_native_nodejs_ts_config`) goes through the resolve hook. Tested: `test/lint/provider/ts-config.test.ts` (ESLint 10 and 9 with jiti, ESLint 10 with type stripping, and a worker whose reads are hidden).
11. **B3, the program before any lint.** `refresh()` walks from each relevant tsconfig's root files: `preProcessFile` gives each file's module specifiers, `/// <reference path>` and `/// <reference types>`; `resolveModuleName` resolves each specifier in both import modes where the resolution kind reads modes (Node16, NodeNext, Bundler), since the walk does not tell an `import` from a `require`; automatic type directives are resolved from the tsconfig's folder. JavaScript files add JSDoc `@import … from` and `import("…")` types by a pattern. The walk follows every file outside `node_modules` (a package's own imports are the install's). Resolution runs again at each refresh, so an added, moved or removed file is seen; each file's specifiers are kept by its stat (mtime and ctime in ns, size, inode). On this repository's tsconfig the walk gives exactly TypeScript's own program outside `node_modules` (2216 files, 10 of them outside `include`); `units.test.ts` compares the two on a small tree too. A full `ts.createProgram` was measured and not used: 4.5 s wall, 7.8 s CPU and 850 MB here (2.3 s, 4.9 s and 610 MB with `noLib` and empty package files).

## Test-only dependencies

typescript-eslint 8.72 needs TypeScript `<6.1.0`; the repository uses TypeScript 7 (no JS API), so npm refuses typescript-eslint as a root dev dependency (ERESOLVE). Root `devDependencies`: `eslint` 10.13.0, `eslint9` (`npm:eslint@9.39.5`) and `squeal-lint-toolchain` (`file:test/fixtures/lint/toolchain`, which holds typescript-eslint 8.72.0 and TypeScript 6.0.3 in its own `node_modules`). The root `overrides` entry `{ "ts-api-utils": { "typescript": "6.0.3" } }` keeps `ts-api-utils` beside TypeScript 6; without it npm puts it at the root, where it loads TypeScript 7 and fails. The tests link these into a temp copy of each fixture (`test/lint/provider/helpers.ts`, `project()`).

## The 200-edit replay (goal 5)

`test/lint/provider/schedule.ts` is 017-01's schedule on `test/fixtures/lint/project` (an import-x stand-in, `eslint-plugin-probe`, registered as `import-x`). `test/lint/provider/replay.ts` acts as the pass: per step it picks D4's level from the snapshot (a file named `eslint.config.*`, then the closure, then a loaded package), refreshes, asks `inputs`, lints the linted sources changed first, and compares every file with the CLI.

- **Record** (the coordinator's call, 2026-10-26): `SQUEAL_LINT_RECORD=1 npx vitest run test/lint/provider/replay-eslint10.test.ts` and the same for `replay-eslint9.test.ts`. It runs a fresh `eslint -f json` at every step, fails on any difference from the provider, and only then writes `test/fixtures/lint/replay-eslint{10,9}.json`. Cost on this host (24 CPUs, load 26 to 32 beside other worktrees' runs): ESLint 10, 303 s wall and 476 s of CPU (410 user, 66 system); ESLint 9, 373 s wall and 526 s of CPU (453 user, 74 system). The first ESLint 10 recording wrote the temp root into step 149's parse error (`… src/t.ts was not found by the project service`); the comparison now writes the root `<root>` on both sides, and that one path string was rewritten in both recordings rather than recorded again. As 017-01 found, a new nested config changes nothing on ESLint 9 (step 181).
- **Routine**: compares every step with the recording, after checking the tool versions and a hash of the project's bytes at each step; a fresh CLI runs live on steps 53 (a local rule's code, `thread`), 133 (a typed program file) and 181 (a new nested config, `instance`). Cost: ESLint 10, 29 s wall and 43 s of CPU, the 3 live CLI runs included; ESLint 9, 43 s wall and 53 s of CPU. With every refresh forced to `none` the ESLint 10 replay reports 78 mismatching file-steps, in each window that needs a refresh, so the comparison discriminates.
- Re-record when the fixture, the schedule, ESLint, typescript-eslint or TypeScript change; the test names the command.

## Cost (goal 9)

A scratch measurement, not a test: the bundled worker driven by its protocol, `worker.cpuUsage()` around each call, ESLint 10 with `@eslint/js` recommended on a 250-line file (`eslint/lib/cli-engine/lint-result-cache.js`), 60 one-line edits, no typed or cross-file rule. Beside the host's real load (one-minute load 32 on 24 CPUs): median 8.6 ms of the worker's CPU per one-file edit (p10 6.5, p90 14.3); loading ESLint and the config plus the first lint 221 ms; the whole process 171 MB RSS. Goal 9's bound is 60 ms. Typed rules and the memory of a warm typed worker are the dogfood row's.

## Cost of the program walk (B3)

A scratch measurement, not a test: `ProgramReader` bundled by esbuild, TypeScript 6.0.3 from the toolchain, this repository's `tsconfig.json` at `196736ef9` (2206 root files, 2216 program files), beside the host's real load (one-minute load 28 to 31 on 24 CPUs).

| Refresh | Wall | CPU | RSS |
| --- | --- | --- | --- |
| First (reads and scans every file) | 662 ms | 1525 ms | 109 to 196 MB |
| Each later one, nothing changed (five runs) | 201 to 229 ms | 216 to 332 ms | grows to 309 MB before a GC |
| One file's stat changed | 147 ms | 151 ms | |

A later refresh still parses the tsconfig (its `include` glob, about 40 ms here) and resolves every specifier again (about 28 000 resolutions in two modes); a file whose stat is unchanged is not read. On the fixture project a refresh takes a few ms.

## What the next rows must know

- **The pass calls `refresh` only above `none`** (`ProviderSession.ready`, `src/core/lint/pass/session.ts:91`). `refresh("none")` walks the program again (the cost above) but finds the relevant tsconfigs once per instance. Without it, a pass after a plain edit keys with the program of the last refresh, so a new import of a file outside the listing reaches no key before lookup (sent to the coordinator for R1, 2026-10-26). A cheaper later walk is possible: keep resolutions while the folders they looked in keep their mtimes; not built.
- **Changed typed program files must be in a lint call**, hits included: `lint()` is the only way to feed the project service, which reads a file it never opened from disk once and never again.
- **`configFiles` holds the root config only.** ESLint 10 reads nested `eslint.config.*` per directory; the pass should treat any path named `eslint.config.{js,mjs,cjs,ts,mts,cts}` as a config file (`instance`), as the replay's `levelOf` does. A nested config already loaded is in `closure` too, so check the name first.
- **`packages` are absolute package folders** (real paths), for 011 C11's identities; a loaded file outside the root and outside `node_modules` stands as its own path.
- **`program` is the complete program at the last refresh** (decision 11), plus what a lint learns from the project service. A lint report does not walk again.
- **The first typed lint builds the program** inside the 5 s per-file guard. On a large program that may time out; dogfood states it (`guardMs` is an option).
- **Not covered:** a data file a config reads with an API other than `fs.readFileSync` (`fs.promises.readFile`, `fs.readFile`) while it loads; a project file only a package imports (the walk does not follow `node_modules`); tsconfig project references (the walk follows sources, as a project service does); a memory cap (`resourceLimits`) on the worker; the cost of the relevance scan, which calls `calculateConfigForFile` on each file of a tsconfig until a typed one.
- **Squeal does not re-run the provider tests on a worker-only edit.** They bundle `worker.ts` with esbuild, whose reads no recorder sees (as `test/keys/key-format.test.ts` notes for 011 C12), and no `squeal.config.json` `inputs` entry names `src/core/lint/provider/**` for `test/lint/**`. Run them with `npx vitest run test/lint/provider test/lint/integration` after such an edit, or add the entry (the coordinator's file).
- **Dist drift until integration:** `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts` ("has the bundles exactly as `npm run build:plugin` produces them"), `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail until `npm run build` adds `cli/lint-worker.mjs`. The Codex bundle count (+5) changed in its own commit by agreement.
