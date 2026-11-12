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
