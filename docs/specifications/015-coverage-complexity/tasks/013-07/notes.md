# 013-07 notes: a project's own coverage setting stays out of Squeal's runs

Worker 00aca89d, 2026-10-24. Brief: `tasks/wave-1c.md` W1. Commit `4be0872d2`.

## Change

- `#start` in `src/runners/vitest/adapter.ts` passes `coverage: { enabled: false }` to `createVitest`. It is the only `createVitest` call in `src/`, so the slow pass's instance (004 D2) gets it too.
- When 015 turns its own provider on, this is the line to change: the options it passes replace `{ enabled: false }`.

## Why a CLI option wins (V1, V2)

- **Vitest 5.0.3** (read in `index.DpLw24bj.js` 9517 to 9545): the `vitest:config:cli` plugin, `enforce: "pre"`, `order: "pre"`, sets `config.test = deepMerge({}, config.test, cliOptions)`. Its comment: "CLI options should have the priority". It runs for the root and for each project.
- **Vitest 4.1.10** (read in `cli-api.BK8pd4xc.js` 14164): `configResolved` sets `options = deepMerge({}, configDefaults, viteConfigTest, options)`, the `createVitest` options last.
- Both: `standalone()` calls `initCoverageProvider()`, then `coverageProvider?.clean(...)`. `resolveCoverageProviderModule` returns `null` when `enabled` is false. No provider loads, so nothing is cleaned, written, printed or thresholded.
- **Limit, accepted.** On Vitest 5 a config plugin whose own `config` hook runs after the CLI plugin and sets `test.coverage.enabled = true` would turn coverage on again. Vitest 4 merges the CLI options at `configResolved`, after every plugin. Not seen in a real config; not handled.

## Probe (throwaway, `/tmp/sq013-07/`, not committed)

Squeal's adapter from this worktree (`tsx probe.mts <root>`) on a project with `coverage: { enabled: true, include: ["src/**"], thresholds: { lines: 99 } }`, the real `@vitest/coverage-v8`, and a `coverage/index.html` the developer wrote. Vitest 4.1.10 and 5.0.3 gave the same results.

| | Before the fix | After the fix |
|---|---|---|
| `coverage/` | `index.html` replaced; 11 report files (HTML, `clover.xml`, `coverage-final.json`) | `index.html` only, the developer's bytes |
| Output | `Coverage report from v8`, the table, `ERROR: Coverage for lines (33.33%) does not meet global threshold (99%)` | no coverage line |
| `process.exitCode` after the run | not set | not set |
| Verdict | `adds` pass | `adds` pass |

The exit code was already not set through the adapter: the run resets `process.exitCode` after each run (013 V4). Q1's `exitCode = 1` came from `warm.mjs`, a bare `createVitest` with the adapter's options and no reset. The fix also stops the threshold's code from being set during the run.

## Test

- `test/runners/vitest/own-coverage.test.ts` over the fixture `test/fixtures/vitest/own-coverage/`. The fixture's folder is not named `coverage`, because the root `.gitignore` rule `coverage/` matches a folder of that name at any depth.
- No coverage package is installed in this repository, and `provider: "v8"` without it stops `standalone()`. So the fixture uses `provider: "custom"` with `coverage-provider.ts`. That provider does what `@vitest/coverage-v8` does to the project: `clean` deletes the reports folder, `reportCoverage` writes a report there and prints a table, and a failed threshold prints an error and sets `process.exitCode`.
- The provider resolves `reportsDirectory` against `config.root`. Vitest keeps it relative (`./coverage`) in the resolved config; the stock providers resolve it themselves. An early version of the fixture used it as given, and the red run wrote `coverage/coverage-final.json` into the worktree root. That file is deleted.
- Red, with the line taken out: `expected [ 'coverage-final.json' ] to deeply equal [ 'index.html' ]`. Green with it.
- The exit-code assertion holds without the fix too, because of the V4 reset. `process.exitCode` is not configurable, so a spy on its setter is not possible. The folder and output assertions are the ones that fail without the fix.

## Decisions

- **Adapter version not raised** (`VITEST_ADAPTER_VERSION` stays `"3"`; the coordinator's decision (a), 2026-10-24, under the human's rule of 2026-10-20: a release re-keys checks only when a key's meaning changed). The evidence:
  - A project without a coverage config gives the same rows before and after. The key-format guard (`test/keys/key-format.test.ts`) compares the adapter with the last release's and runs its validity corpus when they differ; `#start` runs in every case.
  - A project whose config enables coverage: 015-01 Q1 measured every verdict equal with coverage on and off, for v8 and for istanbul ("all verdicts matched coverage off"; with failing thresholds, "Module states were unchanged (all `passed`)"). The probe here gave the same.
  - Only a test that observes coverage could have stored another row. Q5: v8 coverage is visible through `node:inspector` and turned one PASS into a FAIL; istanbul is visible in globals and function source. Such a row stays under its key until an edit to its closure re-keys it and it runs again.
  - A raise would re-key every Vitest check for every user once, for that case alone.
- No spec text changed. Proposed 013 V1 amendment, for the coordinator: "The options also hold `coverage: { enabled: false }`, so a project's own coverage setting never loads a provider in Squeal's instance: its reports folder, the daemon's output and its exit code stay untouched (row 013-07). A `createVitest` option wins over the config on Vitest 4 and 5."
