# 020-26ab notes: records beside the project's V8 coverage (#189)

Worker 29f91714, 2026-11-12, on `cez/29f91714` from `ab437504f`. Spec D19.1 to D19.6 (D19.5 as amended on main).

## Seam map

- `src/runners/vitest/ci-runtime/coverage.cjs` `startCoverage`: the project's `coverage.enabled` is checked first, before Squeal's own missing-provider reason, so `off: "project-coverage"` always means the project's provider ran. `projectCoverage` yields (`yieldReason`, or Squeal's settings missing) or calls `runCoverage` with `v8Batches`. Squeal's own provider goes through `onCoverage` and `squealBatches`. `runCoverage(vitest, settings, stamps, batchesOf)` takes batches from either source: `install()` at `runStart` (the provider exists by then), `take()` at each module end, `collector()` for the header. When the wrap was never installed, `end` gives `off: "project-coverage"` with the reason.
- `coverage-v8.cjs`: `TESTED = ["4.1", "5.0"]`; `yieldReason` (provider not `v8`, browser mode, untested Vitest); `v8Batches` wraps `onAfterSuiteRun` (the original first, its result returned), checks the provider's `name` and `version` at install, writes Vitest 4.1's payload object to `<dir>/<pid>/v8/v8-<n>.json`, takes Vitest 5's path in place, and marks `children: true` when `autoAttachSubprocess` is on and the payload has `isExtendedContext` scripts. Adding a Vitest minor is one entry in `TESTED` and one test.
- `coverage-stamps.cjs`: `allow` and `attachStamps`, moved out of `coverage.cjs` unchanged. The wrap uses only the stamps.
- `coverage-drops.cjs`: `isolateOff(project)`, used by `submit` (a batch from an `isolate: false` project is not mapped) and by `settle`.
- Header: `PartCoverage` gained `collector?: PartCollector` and `collectorVersion?: string`; `NoRecord` gained `"child-process"`. `knownCollector(collector)` in `parts.ts`: absent, `squeal` or `v8`.
- Gate: `unusable` in `src/core/code/gate/parts.ts` refuses another collector: `its records were collected by "<name>", which this Squeal does not read`.
- Export: `providerRan(part)` in `export-check.ts` (coverage on with any collector, or off `project-coverage` or `failed`). `export.ts` `keyFiles` skips a file of such a part whose closure here has `inspector` in `packages.builtins`, and counts it in `inspector`.

## Facts found on the way

- `@vitest/coverage-v8` was not installed here, despite the study; it is now a dev dependency at 5.0.3 (coordinator agreed).
- Vitest 5 calls `onAfterSuiteRun` with the payload path; the V8 provider's payload holds Squeal's own `ci-runtime/*.cjs` scripts as child-process entries when a test spawns a child (Squeal's preloads run there), so any `isExtendedContext` entry marks the file.
- With `autoAttachSubprocess`, plain Vitest counts the child's lines in the report; that does not change with the wrap.

## Left for later

- 020-26c: the Cezar proof on real Vitest 4.1.10 (the kit has only the 4.1 stub; the 4.1 payload object is tested with a fake provider in `test/runners/vitest/ci-coverage-v8.test.ts`).
- `plugins/*/dist` and `plugins/codex-runtime/runtime.json` drift until the integration build: `test/harness/codex/packaging/runtime.test.ts` fails two checks until then.
- Not decided (D19.7): browser-mode V8 coverage, a batch of several files, the report tolerance.

## R1: repair of review 0.1.443 B1 (worker cd3e1881, 2026-11-12)

The blocker: with the project's provider yielded to, nothing per file said a test loaded `node:inspector` at run time; export read only the static closure (`packages.builtins`), which misses `process.getBuiltinModule("node:inspector")` and a helper reached by a computed `import()`.

### Seam map

- `ci-runtime/inspector.cjs` `installWatch(raw, provider)`, installed by `vitest-ci.cjs` in every process and thread before the evidence hooks. In a Vitest worker it attributes each load to `__vitest_worker__.filepath` (with `ctx.projectName`): a `module.registerHooks` resolve hook (Node 22.19, 24 and 26 call it for every `import` and `require` of a builtin, repeated ones too, from the same parent too) and a `process.getBuiltinModule` wrapper. Loads with no file running are ignored (the V8 provider's worker-side `node:inspector/promises` import runs before `filepath` is set). Calls of Squeal's own provider are ignored by their caller frame (`calledFrom`): Vitest re-evaluates `provider.mjs` after each file's module reset, while `filepath` is set, and without this every file was marked. Sticky per worker: after one load, every later file of that worker is marked (`isolate: false`, Node's module cache).
- Proof of a clean file: a line written before each `process.send` and `MessagePort.prototype.postMessage` of the worker while `filepath` is set; Vitest reports every file through one of them.
- Lines go to `<raw>/inspector/<owner>-<pid>-<thread>.ndjson`; `owner` is the Vitest main process (`ppid` of a fork, `pid` of a thread). `readRawRuns` reads only `<raw>/*.json`, so the directory does not disturb it.
- `withWatch` (called from `coverage.cjs` `coveredReporter`, after `coverage.end`): when a provider may have run (`on`, `project-coverage`, `failed`), the header gets `inspector: { loaded, unknown }` (omitted when both are empty), and with `on` a loaded file's record becomes `{ none: "inspector" }`.
- Part: `PartInspector` on both `PartCoverage` forms (additive, optional), relativized by `ci-coverage.ts` `partInspector`. It sits in the coverage header, not on `PartFile`, because `ci-runs.ts` (not this row's) copies per-file coverage only when the header is `on`.
- Export: `export.ts` leaves out `loaded` and `unknown` files of every part with `providerRan`, counted in `inspector`; lists that do not read leave out every file of the part. The static closure check stays.

### Facts found on the way

- A VM pool (`vmThreads`) keeps `__vitest_worker__` in the VM context, so the watch sees no file: every file is `unknown` and the export refuses all of them. Browser mode is the same (no Node worker).
- A pool flag on the command line (`--pool`, `--no-isolate`) changes the run's config, so the export refuses the part for its environment; the tests put those options in the fixture's config.
- `src/cli/ci-export.ts` prints `inspector` as "test files that loaded node:inspector beside a coverage provider"; for `unknown` files that text is not exact.

### Left for later

- Bundles: `plugins/*/dist` and `plugins/codex-runtime/runtime.json` need the integration build (`ci/inspector.cjs` is new, `cli/squeal.mjs` changed).
- Real Vitest 4.1 (020-26c): `__vitest_worker__.filepath` and `ctx.projectName` are read the same way there; not run here.
