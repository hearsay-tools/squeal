# Spec 026 Wave 4 briefs: rows 026-13 and 026-14

Base: `main` after Wave 3 (`0.1.619`, `0aa71303f`).
Standing model: `claude` `opus` `high`.
Two parallel workers with **100% disjoint file ownership**. Coordinator wires the thin `remote-key` lane hook at integration after both settle.

## Shared rules for both workers

- Read `AGENTS.md`, `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D9, D10, D11, D12), `status.md`, and `reviews/0.1.619-r2.md`.
- Edit ONLY files in your own ownership list.
- Do NOT run `pnpm run build`, do NOT edit `dist/`, `plugins/*/dist/`, `package.json`, or `docs/board.md`.
- Do NOT run the full test suite locally; verify with `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, and targeted `pnpm exec vitest run` / Squeal runs on your owned tests.
- Never write absolute home paths in code or tests (use `/srv/...` or `~`). Never read real `HOME`, real `~/.ssh`, or live cloud credentials.
- Commit clean changes on your branch.

---

## Row 026-13: D9 remote coverage mapping + D11 connect-time `dsync` health check + Wave 3 review follow-ups (S1 residual, N1)

### Ownership
- `src/core/runner-host/host.ts`
- `src/core/runner-host/runners.ts`
- `src/core/runner-host/remote/coverage.ts` (new)
- `src/core/runner-host/remote/disk-check.ts` (new)
- `src/core/runner-host/remote/connect.ts`
- `src/core/runner-host/remote/tree-wire.ts`
- `src/core/runner-host/remote/settings.ts`
- `src/core/runner-host/remote/machine-share.ts`
- `src/core/runner-host/remote/lane.ts`
- `src/core/runner-host/remote/daemon-lane.ts`
- `src/core/runner-host/remote/providers/agent37/tunnel.ts`
- `src/core/code/coverage/writer.ts`
- `src/core/daemon/daemon.ts`
- Tests:
  - `test/runner-host/remote/remote-coverage.test.ts` (new)
  - `test/runner-host/remote/disk-check.test.ts` (new)
  - `test/runner-host/remote/settings.test.ts`
  - `test/runner-host/remote/machine-share.test.ts`
  - `test/cli/remote-tunnel.test.ts`
  - `test/runner-host/remote/providers/agent37-attached.test.ts`

### Requirements

1. **D9: Remote coverage mapping on the runner host:**
   - When `lane.coverage === "remote"` and policy has `coverage.enabled: true`:
     - `connect.ts` stops stripping `coverage` from `adapterOptions` and `policy()`.
     - Rewrite remote Vitest `coverage.provider` to the remote host's own bundled provider path (resolve on the remote host via `runners.ts` / `coverageProviderPath` relative to the remote bundle rather than passing a local path from the laptop!) and `coverage.tempDir` to `<remote tree>/tmp/coverage` (made alongside `<tree>/tmp`).
     - In `host.ts` (when `options.tree !== undefined`) + `src/core/runner-host/remote/coverage.ts`: capture every `CoverageRun` emitted during `runOf()`, map each `CoveredFile` on the remote host using `recordHere` + `encodeRecord` (producing compact repo-relative `CoverageRecord`s and deleting remote raw V8 payload temp files immediately after reading; pass `objectFormat` via `RemoteRunOptions` / `HostStart` and skip the remote host's own provider path), and return the encoded records on `RemoteRunReply.coverage` (base64 compressed `CoverageRecord` per test file, ~25 KiB vs 1.5 MB raw V8 payloads).
     - On the local daemon (`lane.ts` -> `daemon-lane.ts` -> `daemon.ts` -> `writer.ts`):
       - Add `recordMapped(runId: string, testFile: TestFileRef, record: SharedRecord): void` to `CoverageWriter` in `src/core/code/coverage/writer.ts` so pre-mapped records skip local mapping and flow straight into the existing `resultKey` wait, batching (`MAX_BATCH_FILES`), busy-store retry, store-process relay (`withWriteKind("record", ...)`), and `onStored` CRAP recomputation.
       - In `lane.ts`: hand remote coverage records to `onRemoteCoverage` **only after** blob proof succeeds (`proven(host, ...)`), excluding any files stripped by D19 `withoutFiles`, and never for refused/lost/unadmitted runs!
     - When `lane.coverage === "off"` (the default for `background`-only lanes): preserve 021 D12 unchanged (strip `coverage` from options and policy, no remote coverage returned).
   - Tests (`remote-coverage.test.ts`):
     - End-to-end remote host test (over `remoteHostOver` + real `CoverageWriter` + `code.sqlite`): remote Vitest or `node:test` run produces compact `CoverageRecord`s with repo-relative paths, raw remote payload temp files are cleaned up, records are stored in `code.sqlite` after blob proof passes, and NO coverage is stored if blob proof fails or run is refused/lost or `coverage: "off"`.

2. **D11: Connect-time `dsync` disk health check:**
   - New module `src/core/runner-host/remote/disk-check.ts`:
     - Runs 20 writes of 4 KiB with `fsync`/`O_DSYNC` inside the remote cache directory (`<places.cache>/squeal`) via remote Node, deletes its temp file, and returns `{ medianMs, samplesMs }`.
   - `settings.ts`: D11 specifies `onSlowDisk` defaults to `"warn"` for `ssh`/`command` and `"refuse"` for managed cloud providers (`agent37`) when `diskCheck.onSlowDisk` is not explicitly set. Keep explicit overrides honored for any provider. Update `settings.test.ts` accordingly.
   - Run the probe **once per machine incarnation** at connect (after Node check, before accepting runs; reset on `sleep()`/`lost()`/re-acquire in `machine-share.ts` or `connect.ts`).
   - When `diskCheck.enabled` is true and `medianMs > diskCheck.maxWriteMs` (default `10` ms):
     - Log and surface in status: `degraded disk: <medianMs> ms/sync, limit <maxWriteMs> ms`.
     - `onSlowDisk: "warn"`: surface the degraded-disk warning in status/log and continue connecting.
     - `onSlowDisk: "refuse"`: throw `RemoteRefusal` naming the degraded disk measurement so `whenLost` fallback fires (and if the machine is a newly acquired managed cloud instance with `sleepOnIdle` and has not retried yet, allow at most one retry on a fresh acquire before falling back!).
   - Tests (`disk-check.test.ts` + `machine-share.test.ts`):
     - Verify real 20x 4 KiB sync probe cleans up its temp file and computes median ms accurately.
     - Verify `enabled: false` skips probe; healthy disk passes silently; slow disk warns and continues under `onSlowDisk: "warn"`; slow disk refuses with `degraded disk: ... ms/sync, limit ... ms` and fires `whenLost` under `onSlowDisk: "refuse"`; runs once per incarnation across multiple lanes sharing one machine.

3. **Wave 3 re-review (`0.1.619-r2.md`) nonblocking follow-ups:**
   - **S1 residual (`tunnel.ts` + `remote-tunnel.test.ts`):** observe `input` `end`/`close`/`error` **before** awaiting `openEndpoint`, and check `input.destroyed || input.readableEnded` when entering `bridge()` so stdin closing during connection setup cannot be missed; close any socket obtained after input termination and clean up all listeners/timers. Add a test destroying stdin during connection setup and asserting prompt settlement without server intervention.
   - **N1 (`machine-share.ts` + `lane.ts` + `agent37-attached.test.ts`):** guard against one lane refreshing remote `.git` while another lane has an active remote run on the same git-capable machine (e.g., track active remote runs on `MachineShare` or defer/block `syncGit` while a remote run is active on another lane, without serializing unrelated static-host runs!). Add a test pausing a repo-reading run on lane A while lane B sees a new commit and requests refresh, asserting lane A's run completes against stable Git state before lane B refreshes.

---

## Row 026-14: D10 cross-platform `environmentMode: "remote-key"`

### Ownership
- `src/core/runner-host/remote/environment.ts`
- `src/core/runner-host/remote/lane-compare.ts`
- `src/core/runner-host/remote/remote-key.ts` (new)
- `src/core/types/runner.ts`
- `src/core/scheduler/keying.ts`
- `src/core/scheduler/record-tier.ts`
- Tests:
  - `test/runner-host/remote/environment.test.ts`
  - `test/runner-host/remote/remote-key.test.ts` (new)

### Requirements

1. **Cross-platform environment comparison (`environment.ts`, `lane-compare.ts`):**
   - Preserve `environmentMode: "match-local"` default 100% unchanged (021 D11.2: `compareEnvironment` must return `equal`).
   - Add `environmentMode?: "match-local" | "remote-key"` option to `environmentDifferences` and `compareRemote`:
     - Under `environmentMode: "remote-key"`:
       - Do **NOT** reject `platform` (`darwin != linux`) or `arch` (`arm64 != x64`) mismatch.
       - Still validate: matching project sets, matching config file blobs (`remoteBlobs[p] === localBlobs[p]`), matching `resolvedConfig` (still stripping `coverage` when `coverage: "off"`), matching `squealVersion`/`runnerVersion`/`adapterVersion`, matching `allowlist` env, matching `installedDependencies` (with the existing single reinstall retry if install differs!), and matching Node version policy (`nodeVersion` checked against any pinned `.nvmrc` / `package.json` `engines.node` or exact match when local policy pins it — note: in cross-platform `remote-key`, allow matching local `nodeVersion` or matching semver `engines.node` when present, rejecting incompatible Node versions clearly!).
     - Export `compareRemoteEnvironment(host, options)` (or return `{ differences, remoteCore }` alongside backward-compatible `compareRemote`) so the lane receives the verified remote `CoreEnvironmentInputs` (`{ squealVersion, nodeVersion, platform, arch, installedDependencies, env }`) on connect.

2. **Distinct remote environment key space + Linux CI export reuse (`remote-key.ts`, `types/runner.ts`, `keying.ts`, `record-tier.ts`):**
   - **KEY_FORMAT_VERSION MUST NOT CHANGE** (`test/keys/key-format.test.ts` must pass with 0 changes to `KEY_FORMAT_VERSION` or `environment-hash.ts`!).
   - Add optional non-hashed metadata on `RunnerEnvironment` (`readonly core?: CoreEnvironmentInputs`) and on `RunReport` (`readonly executedCore?: CoreEnvironmentInputs`, plus optional per-file `readonly fileCores?: readonly { readonly testFile: TestFileRef; readonly core: CoreEnvironmentInputs }[]` when a split tier runs some files locally and some remotely!).
   - In `keying.ts`:
     - When `environment.core` is provided on a `RunnerEnvironment` (e.g. remote `linux/x64` under `remote-key`), `setEnvironments` uses `environment.core` to compute `environmentRecord(core, environment, hashOf, ci)` and `environmentHash(...)`!
     - Because `environment-hash.ts` already encodes `core.nodeVersion`, `core.platform`, `core.arch`, `core.installedDependencies`, `core.env`:
       - Remote `linux/x64` keys are automatically distinct from local `darwin/arm64` keys in the same store (zero collision!).
       - Linux CI exports (`refs/squeal/<sha>`, spec 018) imported into the store carry `linux/x64` environment hashes and therefore **automatically match** the worktree's `remote-key` keys!
     - Expose a clean helper on `Keying` (e.g. `keyForCore(ref: TestFileRef, core: CoreEnvironmentInputs): CheckKey | null`) so `record-tier.ts` can compute the exact key for a file that executed under a different `core` (e.g. a local `darwin` fallback or `needsRepository` split while the worktree is keyed to `linux/x64`).
   - In `record-tier.ts`:
     - **Vision Principle 2 invariant (CRITICAL):** If a completed file's execution core (from `report.fileCores` or `report.executedCore`) differs from the project's currently keyed core (e.g., local macOS fallback while keyed to Linux remote), NEVER store that result under the remote key! Compute `keyForCore(file.ref, executedCore)` and store the result ONLY under the `executedCore` key (and record its `EnvironmentRecord` for `executedCore` too!), without marking the mismatched `file.key` as `current`!
     - When the execution core matches the keyed core (normal local run, or remote run under `remote-key`), store normally at `storeKey` and mark `current` (and coverage stores at that exact `storeKey`!).
   - In `remote-key.ts` (clean integration seam for the coordinator to wire into `lane.ts` / `daemon-lane.ts`):
     - `attachRemoteCore(environments, remoteCore)` -> attaches `core` to `RunnerEnvironment[]`.
     - `tagReportCore(report, core)` and `mergeCoreReports(...)` -> tags `RunReport` with `executedCore` / `fileCores` across split local+remote merges.
     - `remoteKeyStatusLine(target, remoteCore)` -> formats the D10.3 explicit visibility string: e.g. `remote ${target} (${remoteCore.platform}/${remoteCore.arch}, Node ${remoteCore.nodeVersion}); results keyed to remote environment`.

3. **Tests (`environment.test.ts` and `remote-key.test.ts`):**
   - `environment.test.ts`: test `environmentMode: "match-local"` rejects `darwin != linux` and `arm64 != x64`; `environmentMode: "remote-key"` accepts `darwin/arm64` vs `linux/x64`, still rejects config blob mismatch, resolvedConfig mismatch, missing project, allowlist env mismatch, installedDependencies mismatch, and incompatible Node version.
   - `remote-key.test.ts`:
     - Keying with `linux/x64` remote core vs `darwin/arm64` local core produces distinct keys in the same store.
     - A simulated Linux CI export stored under `linux/x64` is an immediate cache hit when keyed under `remote-key` (`linux/x64`), while a `darwin/arm64` local daemon does NOT reuse it.
     - `recordTier` with a remote Linux run stores under the Linux key; a local macOS fallback run (`executedCore: darwin/arm64`) while keyed to `linux/x64` stores ONLY under the `darwin/arm64` key and NEVER pollutes the `linux/x64` key or marks `linux/x64` current!
     - `remoteKeyStatusLine` formats the exact remote platform/arch/Node visibility line.
     - Verify `pnpm exec vitest run test/keys/key-format.test.ts` passes unchanged!
