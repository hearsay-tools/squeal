# Wave 3.5: Repair review 0.1.644 blockers (B1–B5)

Parent candidate: `cand/0.1.644` (`5d7e087d9cb75be17ccac5f04a4ee99c32eac67c`).
Review report: `docs/specifications/027-docker-execution/reviews/0.1.644.md`.
Specs: `docs/specifications/027-docker-execution/spec.md` (D4–D7) and `docs/specifications/028-jest-runner/spec.md` (D2.3).

All three repair workers run in parallel with strictly disjoint file ownership. Do **not** run `pnpm run build` in worker worktrees (the coordinator rebuilds all five plugin bundles at integration). Do **not** run a full local test suite. Do **not** set timers waiting for Squeal background backlogs: read `squeal status --wait 60000 <changed-files>` once, and run `pnpm exec vitest run <explicit-test-paths>` directly (including `test/keys/key-format.test.ts` locally if Squeal's remote VM reports Python fixture gaps).

## Shared contract (between Worker 1 and Worker 2)

- `containerKeyDescriptor(inputs)` in `src/core/runner-host/container/key.ts` MUST remain call-compatible with `runner.ts`'s existing `{ keyMode, image, probe, dockerfileInputs, targetEnv, services }` call.
- `applyContainerEnvironment` and `containerCore` keep their signatures.
- Worker 2 owns `src/core/runner-host/container/key.ts` and keeps `build-content` descriptors identical between managed runs (`runner.ts`) and local in-container CI runs (`ci-export.ts`).

---

## Worker 1: Fix B1, B2, B5 (Row `027-06` repair)

### Ownership
- `src/core/daemon/daemon.ts`
- `src/core/daemon/container-guard.ts`
- `src/core/runner-host/container/index.ts`
- `src/core/runner-host/container/runner.ts`
- `test/runner-host/container/runner.test.ts`
- `test/daemon/container-guard.test.ts`
- `test/daemon/container-bundle-mount.test.ts` (new)

### Requirements

1. **B1: Mount the complete Squeal runtime bundle root, not `dist/cli/`:**
   - In `src/core/runner-host/container/index.ts`, export `bundleRootFor(cliPath: string): string | null`:
     - Installed plugin bundles place the CLI at `<bundleRoot>/cli/squeal.mjs` (or `.cjs`) with sibling runtime directories `jest/squeal-reporter.cjs`, `pytest/squeal_pytest.py`, `observe/recorder.cjs`, `node-test/`, `code/`.
     - When `basename(dirname(cliPath)) === "cli"`, candidate root is `dirname(dirname(cliPath))`; also support a flat bundle dir `dirname(cliPath)` if it directly contains `observe/recorder.cjs`, `jest/squeal-reporter.cjs`, and `pytest/squeal_pytest.py`.
     - Verify that `cliPath` lies inside the returned root AND that the required runtime assets (`observe/recorder.cjs`, `jest/squeal-reporter.cjs`, `pytest/squeal_pytest.py`) exist under that root.
     - If `cliPath` is a source/dev layout or incomplete directory where those runtime siblings do not exist, return `null` (fail closed cleanly: do not mount an incomplete directory).
   - In `src/core/daemon/daemon.ts` (`#containerWiring`), use `bundleRootFor(launch.cli)`. If it returns `null`, log why container routing is unavailable and return `{}` (so container projects stay unknown via the guard, never crashing on missing sibling runtimes). Otherwise pass `bundleDir: bundleRoot` into `ContainerWiring`.
   - Add `test/daemon/container-bundle-mount.test.ts`:
     - Copy the real built `plugins/claude-code/dist` to a temp directory **outside** the worktree (or verify against a temporary copy of an installed layout with `cli/squeal.mjs`, `jest/`, `pytest/`, `observe/`, `node-test/`, `code/`).
     - Exercise the daemon's own `bundleRootFor` / `ContainerWiring` path selection (not a hand-passed `dist` path) and prove that `jestRuntimeDir(cliUrl)`, `pytestRuntimeDir(cliUrl)`, and `observeRecorder(cliUrl)` all resolve inside the mounted `bundleDir`: and that a `dist/cli`-only or source layout refuses cleanly (`null`).

2. **B2: Stamp completed container `RunReport`s with `executedCore`:**
   - In `src/core/runner-host/container/runner.ts`, import `tagReportCore` from `../remote/remote-key.js`.
   - In `ContainerAdapter.run()`, tag the completed `RunReport` returned by `live.proxy.run(testFiles, options)` with `tagReportCore(report, live.core)` before applying the `(in container <target>)` failure suffix and returning.
   - Verify composite merging (`src/core/daemon/report-merge.ts` already uses `mergedExecutedCore`/`mergedFileCores`, do not edit it unless broken) preserves `executedCore`/`fileCores`.
   - Add a scheduler-facing regression in `test/runner-host/container/runner.test.ts` (driving real `WorktreeKeys` + `recordTier` / scheduler recording with a fake container reporting Node `v22.19.0` while host Node is `process.version` e.g. `v26.13.0`, or using a deliberately different container Node like `v22.19.0` vs `v24.0.0`): prove `report.executedCore` equals the container's core, the completed result is stored and becomes current at the container key, `otherMachine` is empty, and no host-machine variant receives the result.

3. **B5: Reconcile live target config and local consent before every batch and run:**
   - In `src/core/runner-host/container/runner.ts`:
     - Allow `ContainerRunnerOptions.target` to be `ContainerTarget | (() => ContainerTarget | undefined)` (keeping direct `ContainerTarget` working for existing unit tests).
     - Track the active container's effective configuration fingerprint on `Live`: `{ target, network, composeProject }` (covering `image`, `env`, `network`, `workdir`, `keyMode`, `dockerfileInputs`, `dependencyServices`, plus resolved consent `network` and `composeProject`).
     - Add `#reconcile()` called at the start of `invalidate`, `recheck`, and `run` **before any Docker command**:
       1. Read `consent = o.consent()` and `target = liveTarget()`.
       2. If `consent === null`, `target === undefined`, or `"problem" in resolveContainerNetwork(target, consent)`:
          - Run **zero** Docker inspection/start commands.
          - If currently `#opened.ok`, tear down the live host and remove only Squeal's managed container (`await this.#teardown(live)`), transition to `{ ok: false, state: "unconsented", note }`, update `status("unconsented")` and `note(...)`, and report recreation.
          - If already `!#opened.ok`, update state/status/note without Docker calls and return whether state changed.
       3. If `!#opened.ok`: try `await this.open()`, return whether state changed (`this.#opened.ok || this.#owed || this.#noted !== before`).
       4. If the live config fingerprint differs from `live.fingerprint` (e.g. target `image`, `env`, `network`, `workdir`, `keyMode`, `dockerfileInputs`, `dependencyServices`, or consent `networkOverride`/`composeProject` changed):
          - Tear down the old host and managed container (`await this.#teardown(live)`), start the replacement (`await this.open()`), and return `true` (recreated).
       5. Otherwise run `checkImage(this.#cli, target.image, live.container.imageId)`. If changed/removed, tear down, reopen, and return `true`.
     - In `run()`: if `!this.#opened.ok` after `#reconcile()`, return `unavailableReport(...)` with zero test runs and zero Docker inspections. If `#reconcile()` replaced a live container, set `this.#owed = true` and return `unavailableReport(...)` so the scheduler re-keys before running.
   - In `src/core/daemon/container-guard.ts`:
     - Pass live `target: () => containers.containers()[project.container]` to `createContainerRunner`.
     - Ensure status updates reflect the live target's `keyMode`.
     - Preserve existing fail-closed behavior and actionable `unconsentedNote` / `containerGuardNote` text when consent is withdrawn.
   - Add regressions in `test/daemon/container-guard.test.ts` reproducing the exact review probe through `createContainerGuardRunner`:
     1. Live target config change (`image: "old"` + `env: { MODE: "old" }` -> `image: "new"` + `env: { MODE: "new" }`, plus `network` and `keyMode` changes): `invalidate` returns `{ recreatedProjects: [project] }`, inspects/starts the new image with `MODE=new`, closes/removes the old managed container, and `environment()` reflects the new target config.
     2. Consent withdrawal (`enabled: true` -> `enabled: false` in `containers.json`): `invalidate` returns `{ recreatedProjects: [project] }`, tears down the live container, performs **zero** further `docker image inspect` or `docker run` calls, `status` reports `"unconsented"`, `environment()` is `"unavailable"`, and `run()` refuses with zero completed files.
     3. Re-enabling consent recovers cleanly on the next `invalidate`.

---

## Worker 2: Fix B3 (Row `027-06` repair)

### Ownership
- `src/core/runner-host/container/key.ts`
- `src/cli/ci-export.ts`
- `test/runner-host/container/key.test.ts`
- `test/ci/export-container-parity.test.ts` (new)
- `test/version-sensitive.txt`

### Requirements

1. **Shared `build-content` descriptor contract (managed and in-container CI):**
   - Inspect why `build-content` currently cannot match between a managed container (`docker image inspect` -> `image.env`) and CI running inside a container without a Docker daemon (`process.env` contains `GITHUB_*`, `HOSTNAME`, `PWD`, `SHLVL`, etc.):
     - Under `keyMode: "build-content"`, the container's image build is already keyed by `packages` (`dpkg-query` / `apk`), `dockerfileInputs` (including `Dockerfile`), `core` (Node/platform/arch), and the runner's own environment.
     - Therefore, in `containerKeyDescriptor` for `keyMode: "build-content"`, key `env` from `targetEnv` alone (`keyedEnv([], inputs.targetEnv)`), stripping `SLOT_VARIABLES` and `LAUNCH_VARIABLES`: NOT `image.env`! Keep `keyMode: "image-id"` keying `keyedEnv(inputs.image.env, inputs.targetEnv)` as before.
     - Keep `ContainerKeyInputs` compatible with `runner.ts` (`image?: ImageInfo` for `build-content`, required for `image-id`, or keep `image: ImageInfo` in the union / overload so existing callers compile unchanged).
   - Export `probeLocalContainer(): Promise<ContainerProbe>` in `src/core/runner-host/container/key.ts`:
     - Uses `process.version`, `process.platform`, `process.arch` and runs the exact same `PACKAGES` shell command (`dpkg-query` / `apk`) locally via `execFile("sh", ["-c", PACKAGES])` with `parsePackages(...)`. Requires zero Docker daemon.
   - Export `ciContainerTargetEnv(targetEnv, ciEnv)` (or `localContainerDescriptor(...)`) in `src/core/runner-host/container/key.ts`:
     - Given a `ContainerTarget` (with `keyMode: "build-content"`), `root`, `squealVersion`, and `ciEnv`:
       - Runs `probeLocalContainer()` (allow injecting a probe for unit tests).
       - Hashes `dockerfileInputs` via `hashInputs(root, target.dockerfileInputs)`.
       - Resolves effective `targetEnv` against `ciEnv`: for each `[name, value]` in `target.env` (excluding `SLOT_VARIABLES` and `LAUNCH_VARIABLES`): if `value` contains a slot placeholder (`{slot}`, `{slot0}`, `{worktreeSlot}`), keep the unexpanded template (matching managed); otherwise if `Object.hasOwn(ciEnv, name)` and `ciEnv[name] !== undefined`, use `ciEnv[name]` (so if CI ran with a different value for a declared target env var, it does not falsely match!), and if unset in `ciEnv`, omit it (so a CI run missing a required target env var does not falsely match!).
       - For `target.dependencyServices`: include `{ service }` for each declared service (no Docker daemon in CI; matches cleanly when `dependencyServices` is `[]`, and stays distinct if local has running services that CI cannot inspect).
       - Returns `{ descriptor, core }` ready for `applyContainerEnvironment(...)`.
   - Export `wrapContainerEnvironmentAdapter(adapter, descriptor, core): RunnerAdapter` (or keep it tidy in `ci-export.ts` / `key.ts`): wraps `adapter.environment()` to return `applyContainerEnvironment(await adapter.environment(), descriptor, core)` while delegating every other `RunnerAdapter` method unchanged.

2. **Wire `src/cli/ci-export.ts`:**
   - In `daemonRunners` (in `src/cli/ci-export.ts`), pass `squealVersion` and `env` (`io.env ?? process.env`).
   - For each `nodeTest` project in `policy.nodeTest`:
     - If `project.container === undefined`: **do nothing**: ordinary host exports stay 100% outside the container key space and unchanged!
     - If `project.container !== undefined`: look up `target = policy.containers[project.container]`.
       - When `target !== undefined && target.keyMode === "build-content"`, compute `{ descriptor, core }` via the shared local container helper (caching `probeLocalContainer()` once per export run) and wrap that project's adapter with `applyContainerEnvironment`.
       - When `target !== undefined && target.keyMode === "image-id"`, do NOT emit an uncontainerized host key: either wrap with an isolated non-matching `"image-id"` descriptor (`imageId: "ci-uninspected"`, `repoDigest: null`) or leave it in the container key space so it never collides with host keys.
   - Check that `nodeTestEntries` in `export-node-test-here.ts` continues to read `nodeBuild` cleanly from the wrapped `resolvedConfig` (`withContainer` preserves all existing fields of `resolvedConfig`).

3. **Tests:**
   - Update/extend `test/runner-host/container/key.test.ts` for `probeLocalContainer` and `build-content` parity without `image.env`.
   - Add `test/ci/export-container-parity.test.ts`:
     - Create a committed temporary git project with `nodeTest: [{ name: "unit", include: ["*.test.cjs"], container: "backend" }, { name: "host", include: ["host/*.test.cjs"] }]` and `containers: { backend: { image: "example:latest", dockerfileInputs: ["Dockerfile"], env: { MODE: "test" } } }`, plus `Dockerfile`.
     - Run real `node --test` with Squeal's CI recorder (`ciRecord` / `squeal ci record`), then run `ciCommand(["export", ...])` with `MODE=test`.
     - Verify:
       1. For `"unit"` (container project): the exported bundle's environment descriptor has `container.keyMode === "build-content"`, matching `dockerfileInputs` hash, `packages`, and `env: [["MODE", "test"]]`.
       2. Build a managed container environment for the exact same project/worktree using `containerKeyDescriptor` + `applyContainerEnvironment` (with the same local probe, `Dockerfile`, `MODE=test`, and a different `image.id` + arbitrary `image.env` like `["PATH=/usr/bin", "EXTRA_IMAGE_VAR=1"]`) and prove the environment hash AND test-file key **equal bit-for-bit**!
       3. Import the exported bundle into a fresh store (`squeal ci import` / `importResults`) and prove the managed container's test file lookup hits and becomes **current (passing)** from the imported CI bundle!
       4. For `"host"` (non-container project): exported environment has **no** `container` field and matches an ordinary host daemon key unchanged.
       5. If CI runs with `MODE=other` instead of `MODE=test`, the exported key does **not** match the managed container key.
   - Add `test/ci/export-container-parity` to `test/version-sensitive.txt` and run `pnpm exec vitest run test/version-sensitive.test.ts` to verify.

---

## Worker 3: Fix B4 (Row `028-05` repair)

### Ownership
- `src/runners/jest/environment.ts`
- `src/runners/jest/adapter.ts`
- `test/runners/jest/environment.test.ts`
- `test/runners/jest/adapter.test.ts`

### Requirements

1. **Capture worktree-local config dependencies during config evaluation (`src/runners/jest/environment.ts`):**
   - Extend `JestRead` on **both** branches:
     - `{ ok: true; project; global; testPaths; preset; configDeps: readonly AbsolutePath[] }`
     - `{ ok: false; error: string; configDeps?: readonly AbsolutePath[] }`
   - In `READER` (the child Node script executed by `readJestProject`), pass `root` (and its `realpath`) so the child can filter to worktree-local files outside `node_modules` and `.git`:
     - Before calling `readConfig(...)`:
       1. Snapshot `Object.keys(require.cache)`.
       2. Register a synchronous `module.registerHooks` `load` hook (guarded in `try/catch` in case of older Node, though Node 22.19+ has it) to capture every `file://` URL loaded via ESM `import()` OR CJS `require()`.
       3. Wrap `fs.readFileSync`, `fs.readFile`, and `fs.promises.readFile` (capturing string/URL path arguments before delegating) so JSON/data files read directly by a config helper are also captured!
     - Run `readConfig` and `readInitialOptions` inside `try { ... } finally { ... }`:
       - Collect all newly added `require.cache` filenames, hook-captured `file://` paths, and `fs`-read file paths that resolve inside the worktree root (checking both `root` and `realpath(root)`) and do not contain `/node_modules/` or `/.git/` (and exist as files).
       - Include `configDeps` in **both** the success JSON output AND the error JSON output (`catch` branch)! That way, if an imported helper throws or has a syntax error, `configDeps` still contains the helper that was loaded before the failure.
     - Restore or stop recording before the `walk(root)` test-file scan so test files themselves are NOT recorded as `configDeps`!
   - In `configFiles(root, project, read, env)`:
     - Include `read.configDeps ?? []` on **both** `read.ok === true` and `read.ok === false`!
     - Keep worktree path normalization (`<worktree>`) and unexpanded `project.env` templates untouched.

2. **Watch `configDeps` across healthy and failed states (`src/runners/jest/adapter.ts`):**
   - Update `Opened`'s failure variant to retain `configDeps: readonly AbsolutePath[]` (from `read.configDeps ?? []` when `!read.ok`).
   - Update `watchedOf(root, project, state, source)` to pass those `configDeps` into `configFiles(...)` even when `!state.ok`.
   - In `invalidate(changed)`: when an imported config dependency changes, `watched.has(p.path)` is `true` -> calls `reopen()` -> rebuilds environment, test file list, and static graph -> returns `{ recreatedProjects: [project.name] }`.
   - When a project failed to open because of an error inside an imported config helper (e.g. `options.cjs` threw or failed to parse), editing `options.cjs` triggers `reopen()`, recovers to `ok: true`, and returns `{ recreatedProjects: [project.name] }`!
   - Also check `unavailableEnvironment`: include `configDeps` in `files` if any were captured.

3. **Tests on both Jest 29.7.0 and Jest 30.5.2 (`test/runners/jest/environment.test.ts`, `test/runners/jest/adapter.test.ts`):**
   - Remember: pre-installed fixtures already exist at `/tmp/squeal-jest-29-2754338cf9ef` and `/tmp/squeal-jest-30-b9e0c22dec2f`; `TMPDIR=/tmp` makes `test/helpers/jest-env.ts` reuse them without reinstalling. Never mutate the cached fixtures.
   - Add regressions for **both Jest 29 and Jest 30**:
     1. Imported CJS config helper (`...require("./options.cjs")`) changing a scalar option (`testTimeout: 1000` -> `9000`): `environment().files` contains `options.cjs`; `invalidate([{ path: "options.cjs", kind: "change" }])` returns `{ recreatedProjects: [project.name] }`; live adapter's `environment()` equals a freshly opened adapter's `environment()`.
     2. Nested helper chain (`jest.config.cjs` -> `./a.cjs` -> `./b.cjs`) and changing `testMatch` / `moduleNameMapper` inside the helper: live adapter's `testFiles()`, `affected()`, and `environment()` after `invalidate` match a freshly opened adapter!
     3. Error recovery: `options.cjs` initially throws an error -> adapter starts unavailable (`runnerVersion: "unavailable"`, `testFiles()` empty) -> fix `options.cjs` -> `invalidate([{ path: "options.cjs", kind: "change" }])` returns `{ recreatedProjects: [project.name] }`, adapter recovers to healthy and matches a fresh adapter!
     4. Test files discovered by `walk` are NOT leaked into `environment().files`.

---

## Verification (each worker)

1. Run `pnpm run lint && pnpm run typecheck`.
2. Run `squeal status --wait 60000 <your-changed-test-files>` once; if Squeal is unavailable or pending, run `pnpm exec vitest run <your-changed-test-files>` directly (with `TMPDIR=/tmp` for Jest tests).
3. Run `pnpm exec vitest run test/keys/key-format.test.ts` locally (for Workers 1 and 2; Worker 3 if touching environment inputs).
4. Keep your git tree clean with focused commits and no `plugins/*/dist` edits.
