# 017-04: notes for the next rows

Worker 2e373245, 2026-10-26. The ESLint provider in its own worker thread, against the wave 1 interface as the coordinator amended it on 2026-10-26 (`refresh(level)`, `lint(files)` without a level, `LintOff`). No daemon wiring: 017-05's pass takes it at integration.

## Seam map

| File | What it holds |
| --- | --- |
| `src/core/lint/provider/types.ts` | The interface copy. 017-05 owns the same types in `src/core/lint/pass/provider.ts`; this copy goes at integration. |
| `src/core/lint/provider/eslint-provider.ts` | `eslintProvider({ root, script?, env?, guardMs?, loadGuardMs?, now? })`. Host side: calls one at a time, D4 levels, failure count, `off`. |
| `src/core/lint/provider/thread.ts` | `LintThread`: one `Worker`, its guard (restarted at each progress message), `ThreadFailure` (timed out, threw, exited) and `CallError` (the worker answered an error and lives on). |
| `src/core/lint/provider/worker.ts` | The worker entry, bundled as `cli/lint-worker.mjs`. A `module.registerHooks` resolve hook, set before ESLint loads, records every module the thread resolves. |
| `src/core/lint/provider/session.ts` | Worker side: discovery (`eslint/package.json` from the root, `loadESLint`, `cwd` given), `inputs`, `lint` with the program feed, the environment. |
| `src/core/lint/provider/program.ts` | The tsconfig program from TypeScript's config parse (`getParsedCommandLineOfConfigFile`), no type check. |
| `src/core/lint/provider/loaded.ts` | Resolved module URLs as project files (`closure`) and package roots (`packages`). |
| `src/core/lint/provider/signals.ts` | D5's whole-program signals from a computed config's JSON. |
| `src/core/lint/provider/protocol.ts` | The messages, `PROVIDER_VERSION` (1) and `ROOT_TOKEN` (`<root>`). |
| `src/core/lint/provider/script.ts` | `lintWorkerScript()`: `lint-worker.mjs` beside the bundled CLI, `worker.js` beside tsc's build, `null` from the sources (then `open()` is off). |

## Decisions the spec did not settle

1 to 4 were agreed with the coordinator on 2026-10-26; 5 to 9 are this row's choices.

1. `inputs()` rejects with an `Error` whose message is D9's reason when the config does not load, the worker fails or the provider is off.
2. The computed config's JSON has the project root (and its real path) written `<root>`. A typed config holds `tsconfigRootDir` as an absolute path on ESLint 9 and 10, so without it no typed file's key is shared between worktrees (goal 7).
3. The third worker failure (timed out, threw, exited) within 10 minutes turns the provider off; that call resolves `{ off: "the ESLint worker failed 3 times; <reason>" }`. `refresh("instance" | "thread")` and `open()` clear the off state and the count. An earlier failure gives every file of that call `unknown` with the reason (D9: the part's files), and the next call starts a new worker. A failure while no call is in hand (a plugin's late timer) counts too.
4. `refresh()` reports `program` and the tsconfigs in `closure` before any lint. A `tsconfig.json` under the root (outside `node_modules` and dot folders) counts when one of its files gets a typed config from `calculateConfigForFile`, which applies ESLint's own `files` and ignores; `project` as paths names its tsconfigs instead. `lint()` adds what it learns (accumulates per thread).
5. `lint()` feeds typed files and the given program files ESLint does not lint to TypeScript's project service, by the config's own parser (`parseForESLint`), before it lints, when the call holds more than one of them; a typed file alone is parsed first only when it is outside the known program, to learn its program. Tested with `projectService`; `project` (typescript-estree's own programs) is not. A fed file ESLint does not lint gets no entry in `results`. A file that is neither linted nor in the program reads `unknown: ESLint does not lint this file`.
6. A file a rule throws on reads `unknown: ESLint failed on this file: <first line>`; the worker lives on. A parse error is a finding with `rule: null` (D9).
7. A plugin's 0 ms timer that throws fails the call it was set in: the worker waits one timer turn before it answers.
8. The worker runs with `execArgv: []`, the daemon's environment plus `TSESTREE_SINGLE_RUN=false`; a plugin's stdout and stderr are read and dropped.
9. Off reasons: `no ESLint installed in <root>`, `ESLint <major> is not supported`, `eslintrc configs are not supported; ESLint 9 and 10 read eslint.config.*` (ESLint 9 with `ESLINT_USE_FLAT_CONFIG=false`), `the ESLint worker's script is not built`.

## Test-only dependencies

typescript-eslint 8.72 needs TypeScript `<6.1.0`; the repository uses TypeScript 7 (no JS API), so npm refuses typescript-eslint as a root dev dependency (ERESOLVE). Root `devDependencies`: `eslint` 10.13.0, `eslint9` (`npm:eslint@9.39.5`) and `squeal-lint-toolchain` (`file:test/fixtures/lint/toolchain`, which holds typescript-eslint 8.72.0 and TypeScript 6.0.3 in its own `node_modules`). The root `overrides` entry `{ "ts-api-utils": { "typescript": "6.0.3" } }` keeps `ts-api-utils` beside TypeScript 6; without it npm puts it at the root, where it loads TypeScript 7 and fails. The tests link these into a temp copy of each fixture (`test/lint/provider/helpers.ts`, `project()`).

## The 200-edit replay (goal 5)

`test/lint/provider/schedule.ts` is 017-01's schedule on `test/fixtures/lint/project` (an import-x stand-in, `eslint-plugin-probe`, registered as `import-x`). `test/lint/provider/replay.ts` acts as the pass: per step it picks D4's level from the snapshot (a file named `eslint.config.*`, then the closure, then a loaded package), refreshes, asks `inputs`, lints the linted sources changed first, and compares every file with the CLI.

- **Record** (the coordinator's call, 2026-10-26): `SQUEAL_LINT_RECORD=1 npx vitest run test/lint/provider/replay-eslint10.test.ts` and the same for `replay-eslint9.test.ts`. It runs a fresh `eslint -f json` at every step, fails on any difference from the provider, and only then writes `test/fixtures/lint/replay-eslint{10,9}.json`. Cost on this host (24 CPUs, load 26 to 32 beside other worktrees' runs): ESLint 10, 303 s wall and 476 s of CPU (410 user, 66 system); ESLint 9, 373 s wall and 526 s of CPU (453 user, 74 system). The first ESLint 10 recording wrote the temp root into step 149's parse error (`… src/t.ts was not found by the project service`); the comparison now writes the root `<root>` on both sides, and that one path string was rewritten in both recordings rather than recorded again. As 017-01 found, a new nested config changes nothing on ESLint 9 (step 181).
- **Routine**: compares every step with the recording, after checking the tool versions and a hash of the project's bytes at each step; a fresh CLI runs live on steps 53 (a local rule's code, `thread`), 133 (a typed program file) and 181 (a new nested config, `instance`). Cost: ESLint 10, 29 s wall and 43 s of CPU, the 3 live CLI runs included; ESLint 9, 43 s wall and 53 s of CPU. With every refresh forced to `none` the ESLint 10 replay reports 78 mismatching file-steps, in each window that needs a refresh, so the comparison discriminates.
- Re-record when the fixture, the schedule, ESLint, typescript-eslint or TypeScript change; the test names the command.

## Cost (goal 9)

A scratch measurement, not a test: the bundled worker driven by its protocol, `worker.cpuUsage()` around each call, ESLint 10 with `@eslint/js` recommended on a 250-line file (`eslint/lib/cli-engine/lint-result-cache.js`), 60 one-line edits, no typed or cross-file rule. Beside the host's real load (one-minute load 32 on 24 CPUs): median 8.6 ms of the worker's CPU per one-file edit (p10 6.5, p90 14.3); loading ESLint and the config plus the first lint 221 ms; the whole process 171 MB RSS. Goal 9's bound is 60 ms. Typed rules and the memory of a warm typed worker are the dogfood row's.

## What the next rows must know

- **The pass calls `refresh` before `inputs`**, as the amended interface says; `refresh("none")` re-reads the tsconfig program (cheap) but finds the relevant tsconfigs once per instance.
- **Changed typed program files must be in a lint call**, hits included: `lint()` is the only way to feed the project service, which reads a file it never opened from disk once and never again.
- **`configFiles` holds the root config only.** ESLint 10 reads nested `eslint.config.*` per directory; the pass should treat any path named `eslint.config.{js,mjs,cjs,ts,mts,cts}` as a config file (`instance`), as the replay's `levelOf` does. A nested config already loaded is in `closure` too, so check the name first.
- **`packages` are absolute package folders** (real paths), for 011 C11's identities; a loaded file outside the root and outside `node_modules` stands as its own path.
- **`program` from the config parse is each tsconfig's root files.** A project file the program imports from outside `include` appears only once a lint learns it.
- **The first typed lint builds the program** inside the 5 s per-file guard. On a large program that may time out; dogfood states it (`guardMs` is an option).
- **Not covered:** modules an `eslint.config.ts` loads through jiti (no resolve hook sees them); a memory cap (`resourceLimits`) on the worker; the cost of the relevance scan, which calls `calculateConfigForFile` on each file of a tsconfig until a typed one.
- **Dist drift until integration:** `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts` ("has the bundles exactly as `npm run build:plugin` produces them"), `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail until `npm run build` adds `cli/lint-worker.mjs`. The Codex bundle count (+5) changed in its own commit by agreement.
