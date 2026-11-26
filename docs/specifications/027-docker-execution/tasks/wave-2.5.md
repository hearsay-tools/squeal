# Spec 027 / 028 Wave 2.5: Repair review 0.1.643 blockers B1, B2, and B3

Candidate `5810ad589` (`0.1.643`) received verdict **FAIL** in `docs/specifications/027-docker-execution/reviews/0.1.643.md` with three proven blockers (B1 on `027-04`, B2 on `028-04`, B3 on `028-03`).

This repair wave runs three strictly disjoint workers in parallel, then re-gates and runs a narrow re-review (`reviews/0.1.643-r2.md`).

Hard rules for all three workers:
- Read `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, and `docs/specifications/027-docker-execution/reviews/0.1.643.md`.
- Stay strictly inside your file ownership below.
- Do not run `pnpm run build` or touch `package.json`, `install.sh`, `plugins/`, or `docs/board.md`.
- Do not bump `KEY_FORMAT_VERSION`, any adapter version, or `RECORDER_VERSION`.
- Verify `pnpm exec vitest run test/keys/key-format.test.ts` passes locally (zero uncovered changed lines, zero differing outputs against the last release), plus your targeted tests, `pnpm run lint`, and `pnpm run typecheck`.
- Never run a full test suite. Never commit absolute home paths or private names. Never use em-dashes in docs or comments.

---

## Repair B1 (row 027-04): guard container-configured projects from running on host or remote

**Review finding:** B1 in `docs/specifications/027-docker-execution/reviews/0.1.643.md`.

**Problem:** `policy-containers.ts` accepts and retains a valid `container` reference on `nodeTest` and `pytest` projects, but `createNodeTestRunners` / `createNodeTestRunnerSet` (`src/core/daemon/node-test-runners.ts`) and `createPytestRunners` / `createPytestRunnerSet` (`src/core/daemon/pytest-runners.ts`) pass those projects unchanged to host adapters (and remote wrappers). As a result, a container-targeted project with no local consent runs directly on the host and admits a host pass with no unconsented note.

**File ownership (strictly disjoint):**
- `src/core/daemon/container-guard.ts` (new)
- `src/core/daemon/node-test-runners.ts`
- `src/core/daemon/pytest-runners.ts`
- `src/core/runner-host/container/consent.ts` (only if a helper refinement is needed)
- `test/daemon/container-guard.test.ts` (new)

**Requirements:**
1. Before creating any local host adapter or wrapping with `options.remote`, inspect whether `project.container !== undefined` in BOTH `node-test-runners.ts` and `pytest-runners.ts`.
2. When `project.container !== undefined`, do NOT start the local host adapter and do NOT route to `options.remote`:
   - Load user-local consent via `loadContainerConsent()` and `containerConsentFor(settings, root, commonDir)` (resolve `commonDir` from `root` cleanly using the repo's existing git common-dir helper, falling back cleanly when `root` is not a git repo, and NEVER calling `docker`).
   - Emit one actionable note via `options.note(text, topic)`:
     - When consent is absent, disabled, or does not allow `project.container`: emit `unconsentedNote(project.name, project.container, settings.path)` (mentioning `squeal setup` and that Docker socket access is root-equivalent).
     - When consent IS enabled for `project.container` (since live container execution and container environment keys land in row `027-06`): emit a clear unavailable note stating container target `<target>` execution is not yet enabled in this version, so its checks stay `unknown` rather than falling back to the host.
   - Return a guarded `RecoveringRunner` (wrapping a lightweight unavailable `RunnerAdapter`) that:
     - reports `environment()` with `runnerVersion: "unavailable"` and `resolvedConfig` carrying the unavailable state/note (so nothing is keyed or inherited from host runs),
     - returns `unavailable` (`end: "crashed"`, `completedFiles: []`, `results: []`, `fileErrors: []`, `failure: note`) from `run(...)` without ever spawning a test process,
     - re-checks consent on `recheck()` / `invalidate()` cleanly if `containers.json` changes, while still never falling back to host/remote execution.
3. Keep all non-container projects (`project.container === undefined`) 100% unchanged.
4. Add daemon-facing tests in `test/daemon/container-guard.test.ts` covering BOTH `createNodeTestRunners` and `createPytestRunners` with:
   - absent `containers.json` (reproducing the exact review probe: `HOST_RAN` is NOT created, `results` is `[]`, `completedFiles` is `[]`, `environment()` is unavailable, and the unconsented note is emitted),
   - disabled consent (`enabled: false`),
   - wrong-target consent (`targets: ["other"]`),
   - enabled matching consent (still never runs on host or remote until row `027-06`, leaves checks unknown with an honest note),
   - a sibling non-container project in the same policy still runs normally.
5. Verify:
   - `pnpm exec vitest run test/daemon/container-guard.test.ts test/daemon/policy-containers.test.ts test/runner-host/container/consent.test.ts test/keys/key-format.test.ts`
   - `pnpm run lint && pnpm run typecheck`

---

## Repair B2 (row 028-04): Jest static graph extension precedence and alias rules

**Review finding:** B2 in `docs/specifications/027-docker-execution/reviews/0.1.643.md`.

**Problem:** `src/runners/jest/graph/index.ts:85` passes `rules: "tsx"` into `createResolver(...)` (`src/runners/js-graph/resolver.ts`), which selects `TSX_EXTENSIONS` (`.ts` before `.js`) and `TSX_ALIAS` (rewriting `.js` to `.ts`). Real Jest 29 and 30 use `moduleFileExtensions` (default `["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json", "node"]`), so `require("./helper")` loads `helper.js` ahead of `helper.ts` and `require("./helper.js")` loads `helper.js`. Consequently the static graph missed `helper.js` in `closure()` and returned empty `affected(["helper.js"])`.

**File ownership (strictly disjoint):**
- `src/runners/js-graph/resolver.ts`
- `src/runners/jest/graph/index.ts`
- `src/runners/jest/graph/mapper.ts`
- `test/runners/jest/graph/graph.test.ts`

**Requirements:**
1. Decouple Jest's extension resolution order and extension aliases from `node:test`'s `tsx` rules without changing `node:test`'s behavior in any way:
   - Allow `createResolver` in `src/runners/js-graph/resolver.ts` to accept optional `extensions?: readonly string[]`, `extensionAlias?: Readonly<Record<string, readonly string[]>>`, and `useTsconfig?: boolean` (or explicit resolver-rule options), keeping default `"tsx"` and `"node"` behavior 100% identical for `node:test`.
   - When Jest provides explicit `extensions` / `extensionAlias: {}`, ensure `resolver.ts` does NOT apply `tsx`'s `.js -> .ts` alias or `TSX_EXTENSIONS` order (check every place in `resolver.ts` that inspects `tsx`, `TSX_EXTENSIONS`, `TSX_ALIAS`, `tsxSpecifier`, and `pair`!).
   - **Key-format validity care:** `src/runners/js-graph/resolver.ts` is bundled into `NODE_TEST_ADAPTER_VERSION`'s validity entry! Every changed line in `src/runners/js-graph/resolver.ts` MUST execute during existing `node:test` validity cases with equal output (avoid multi-line dead branches that only run for Jest; use concise single-line `??` / expressions where defaults execute on every `node:test` run, and run `test/keys/key-format.test.ts` locally to prove 12/12 pass with zero uncovered lines!).
2. In `src/runners/jest/graph/index.ts` and `src/runners/jest/graph/mapper.ts`:
   - Add optional `readonly moduleFileExtensions?: readonly string[] | undefined` to `JestGraphOptions`, defaulting to Jest's real default `["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "json", "node"]`.
   - Normalize extensions with leading `.` and pass them (with `extensionAlias: {}`) to `createResolver` and `mappedResolver`, so both direct imports and `moduleNameMapper` rewrites follow Jest's exact `moduleFileExtensions` order!
   - Keep `tsconfig` `paths` / `baseUrl`, `moduleNameMapper`, `setupFiles` / `setupFilesAfterEnv`, workspace symlink realpaths, and snapshot ownership working cleanly.
3. Add regression tests in `test/runners/jest/graph/graph.test.ts`:
   - Coexisting `helper.js` and `helper.ts` with `require("./helper")`: `closure()` includes `helper.js` (not `helper.ts`), `affected(["helper.js"])` returns the test file direct, and compare against real Jest 29.7.0 and 30.5.2 execution (use `test/helpers/jest-env.ts` or note `/tmp/squeal-jest-29-*` reuse).
   - Explicit `require("./helper.js")` with coexisting `helper.ts` resolves to `helper.js`.
   - Custom `moduleFileExtensions: ["ts", "js"]` flips precedence to `helper.ts` when configured.
4. Verify:
   - `pnpm exec vitest run test/runners/jest/graph/graph.test.ts test/runners/node-test/graph.test.ts test/runners/node-test/graph-tsconfig.test.ts test/runners/boundaries.test.ts test/keys/key-format.test.ts`
   - `pnpm run lint && pnpm run typecheck`

---

## Repair B3 (row 028-03): surface throwing globalTeardown and abnormal batch exits

**Review finding:** B3 in `docs/specifications/027-docker-execution/reviews/0.1.643.md`.

**Problem:** In `src/runners/jest/run/results.ts:247` (`ending()`), as soon as every expected test file has a flushed `fileResult` record, `ending()` returns `{ end: "completed", failure: null }`, ignoring `batch.exit`. When Jest's `globalTeardown` throws (or the process exits abnormally after the last file flushed), Jest exits with code 1 and writes the error to stderr, yet `runJest` returns `end: "completed"`, `failure: null`, `fileErrors: []`, and passing `results`.

**File ownership (strictly disjoint):**
- `src/runners/jest/run/results.ts`
- `src/runners/jest/run/run.ts`
- `src/runners/jest/run/events.ts` (only if needed)
- `test/runners/jest/run/results.test.ts`
- `test/runners/jest/run/run.test.ts`

**Requirements:**
1. Inspect how `src/core/scheduler/` consumes `RunReport` (`end`, `failure`, `completedFiles`, `results`, `fileErrors`) so that an abnormal non-zero exit (such as throwing `globalTeardown`) can NEVER result in stored clean passes while still preserving diagnostic visibility!
2. Distinguish clearly between:
   - **Expected non-zero exit 1 explained by mapped failures:** `batch.exit.code === 1` AND the batch has at least one failed check (`outcome === "fail"`) or `fileError !== null` (and `runComplete` was received, or failures already account for exit 1) -> `end: "completed"`, `failure: null`, no double-reporting.
   - **Abnormal exit / teardown failure (not cancelled, not expired):**
     - `batch.exit.error !== null`, OR
     - `batch.exit.signal !== null`, OR
     - `batch.exit.code !== 0` when the batch has NO mapped check failures and NO `fileError`s (for example `globalTeardown` throwing after all tests passed!), OR
     - `batch.exit.code !== 0 && batch.exit.code !== 1` (abnormal non-1 exit code even if tests failed).
     In these cases:
     - Report `end: "crashed"` and a clear non-null `failure` string naming the exit code/signal, log path, and a bounded relativized excerpt from `stderr-<batch>.log` (so errors like `TEARDOWN_PROOF_643` surface directly in `report.failure`!).
     - Ensure files from the abnormally-exiting batch are NOT reported in `completedFiles` (so the core never stores a clean pass from a batch whose `globalTeardown` threw or whose process crashed!), while keeping diagnostic failure text clear (or verify core scheduler contract: in Squeal, only `completedFiles` are stored as verdicts; omitting crashed-batch files from `completedFiles` guarantees zero false passes!).
3. Preserve exact Kit K8 cancellation and timeout behavior (`cancelled` / `expired` keeps files flushed before `batch.cut`).
4. Add real Jest 29.7.0 AND Jest 30.5.2 tests in `test/runners/jest/run/run.test.ts` (plus unit tests in `results.test.ts`):
   - Throwing `globalTeardown` after a passing test -> `report.end === "crashed"`, `report.failure` names exit code 1 and includes the teardown error message (`TEARDOWN_PROOF`), and `report.completedFiles` does NOT admit the file as a clean pass!
   - Abnormal non-zero exit (`code: 2` or post-file crash) -> `report.end === "crashed"` with descriptive `report.failure`.
   - Ordinary failing test exiting 1 -> `report.end === "completed"`, `report.failure === null`, `completedFiles` includes the file with its `fail` result (no double-reporting!).
   - Existing Kit K8 cancellation test still passes unchanged.
5. Verify:
   - `pnpm exec vitest run test/runners/jest/run/results.test.ts test/runners/jest/run/run.test.ts test/runners/boundaries.test.ts test/keys/key-format.test.ts`
   - `pnpm run lint && pnpm run typecheck`
