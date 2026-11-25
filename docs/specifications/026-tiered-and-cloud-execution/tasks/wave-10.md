# Spec 026 Wave 10 briefs

Approved by the human (2026-11-25) after live Agent37 review on `cezar` (`hearsay-tools/squawk`) and `squeal` (`hearsay-tools/squeal`). Four disjoint rows fix the three false-failure causes on remote VMs and add remote provenance on failures.

## 026-25: Expose provisioned remote `pnpm`/`yarn` on runner-host `PATH`

- **Outcome**: Remote `runner-host` exposes the provisioned `pnpm` or `yarn` `.bin` directory (and its Node dir) on `process.env.PATH` for test runs, including when `node_modules` is already installed (`unchanged`).
- **Shape**: slice
- **Spec / context**: Spec 026 row `026-22`; live failure `spawnSync pnpm ENOENT` on Agent37 Node 26 VMs (`cezar` `.github/scripts/release-finalization.test.cjs`, `squeal` `test/keys/validity/lock.test.ts` and `test/lint/integration/{install,pnpm-shim}.test.ts`).
- **Starting seam**: `src/core/runner-host/remote/tree-install.ts` (`installTree`) currently returns early on `unchanged` and only passes `managerEnv(...)` to the install child, never updating the host's `env.PATH`. Resolve `managerEnv` before the `unchanged` return whenever `locks` is non-empty, call an optional `place.onPath?.(env.PATH)` callback, and wire `createTreeHost` (`tree-host.ts`) to update `env.PATH` (which defaults to `process.env`, so tests passing a custom `env` object stay isolated while real `runner-host` exposes `pnpm`/`yarn` to all runner children).
- **Files owned**:
  - `src/core/runner-host/remote/package-manager.ts`
  - `src/core/runner-host/remote/tree-install.ts`
  - `src/core/runner-host/remote/tree-host.ts`
  - `test/runner-host/remote/package-manager.test.ts`, `test/runner-host/remote/tree-install.test.ts`, `test/runner-host/remote/tree-host.test.ts` (edit/add as needed)
- **Leave alone (sibling-owned)**: `bundle.ts`, `connect.ts`, `lane-compare.ts`, `git-version.ts`, `lane.ts`, `daemon-lane.ts`, `src/runners/process/recorders.ts`.
- **Done when**:
  - Unit tests prove that both a fresh install and an `unchanged` install expose the provisioned `pnpm`/`yarn` `.bin` dir on `env.PATH` via `createTreeHost(...).install()` without mutating `process.env` when a custom `env` is passed, and without reinstalling `node_modules` on `unchanged`.
  - `pnpm run lint`, `pnpm run typecheck`, and affected tests pass.
- **Role**: Use `/worker`.

## 026-26: Recognize remote bundle recorder paths in `isSquealRecorder`

- **Outcome**: `isSquealRecorder` (and `withoutSquealRecorders` / `ownNodeOptions`) strips Squeal's own `observe/recorder.cjs` and `node-test/recorder.cjs` when loaded from a remote bundle `<cache>/squeal/<version>/...` (path or `file:` URL), while continuing to reject non-Squeal paths such as `/work/app/observe/recorder.cjs`.
- **Shape**: slice
- **Spec / context**: `src/core/runner-host/remote/bundle.ts` copies the bundle to `<cache>/squeal/<version>/` (dropping `dist/`), causing 48 tests across 21 files in Squeal's own suite to fail on Agent37 because nested `node:test` and `squeal ci record` runs keep `--import file:///home/node/.squeal-remote/squeal/0.1.634/observe/recorder.cjs` in `NODE_OPTIONS`.
- **Starting seam**: `src/runners/process/recorders.ts` (`RECORDERS` and `isSquealRecorder`). Match remote bundle paths `/\/squeal\/[^/]+\/(?:observe|node-test)\/recorder\.cjs$/` alongside the existing four suffixes (and verify `test/runners/node-test/recorders.test.ts` negative cases stay `false`).
- **Files owned**:
  - `src/runners/process/recorders.ts`
  - `test/runners/node-test/recorders.test.ts`
- **Leave alone (sibling-owned)**: everything under `src/core/runner-host/remote/` and `src/core/retry/` / `src/core/status/` / `src/core/scheduler/`.
- **Done when**:
  - `test/runners/node-test/recorders.test.ts` covers remote bundle paths and `file://` URLs for both `observe/recorder.cjs` and `node-test/recorder.cjs`, plus negative cases (`/work/app/observe/recorder.cjs`, relative paths, `.mjs`).
  - `pnpm run lint`, `pnpm run typecheck`, `pnpm exec vitest run test/runners/node-test/recorders.test.ts test/keys/key-format.test.ts` pass (and verify `key-format.test.ts` needs no key bump; stop and message parent if it fails).
- **Role**: Use `/worker`.

## 026-27: Refuse remotes with older Git versions before running under local keys

- **Outcome**: Remote connects probe the remote's `git --version` at zero extra SSH round-trip, and `compareRemoteEnvironment` refuses a remote whose Git is missing or older (`major.minor`) than local Git so old-Git VMs (e.g. Debian 12 Git 2.39.5 vs local 2.43.0) never store false failures under local keys.
- **Shape**: slice
- **Spec / context**: Spec 021 D11.2 / Spec 026 D10. Do **not** add `gitVersion` to `CoreEnvironmentInputs` or `KEY_FORMAT_VERSION` (CI runs Git 2.56.1 against local 2.43.0; keys must stay byte-identical).
- **Starting seam**:
  1. New `src/core/runner-host/remote/git-version.ts`: parse `git --version` output (`git version 2.39.5...` -> `[major, minor, patch]`), cached `localGitVersion()` (via `execFileSync("git", ["--version"])`), and `gitVersionRefusal(remoteGit, localGit)` comparing `[major, minor]`: returns `null` if `remoteGit === undefined` (unreported by fake test hosts), `localGit === null`, or `remote >= local` (by `major.minor`); returns a clear refusal string if `remoteGit === null` (`git is not installed on the remote (${local} here)`) or `remote < local` (`git ${remote} on the remote is older than ${local} here; upgrade Git on the remote or disable the remote lane`).
  2. `src/core/runner-host/remote/bundle.ts`: extend `CHECK_SCRIPT` and `RemoteCheck` to probe `git --version` (try/catch -> `git: string | null`, parsed or raw string) with zero extra SSH calls.
  3. `src/core/runner-host/remote/connect.ts`: expose `readonly gitVersion?: string | null` on `RemoteHost`, populated from `ensured.check.git`.
  4. `src/core/runner-host/remote/lane-compare.ts`: check `gitVersionRefusal(host.gitVersion, options.localGitVersion ?? localGitVersion())` inside `differences()` (when `environmentMode` is `"match-local"` OR `sameMachine(remoteCore, core)` under `"remote-key"`) and push any refusal into `differences`.
- **Files owned**:
  - `src/core/runner-host/remote/git-version.ts` (new)
  - `src/core/runner-host/remote/bundle.ts`
  - `src/core/runner-host/remote/connect.ts`
  - `src/core/runner-host/remote/lane-compare.ts`
  - `test/runner-host/remote/git-version.test.ts` (new), plus existing bundle/connect/lane-compare tests under `test/runner-host/remote/`
- **Leave alone (sibling-owned)**: `package-manager.ts`, `tree-install.ts`, `tree-host.ts`, `lane.ts`, `lane-proof.ts`, `daemon-lane.ts`, `src/core/keys/*`.
- **Done when**:
  - Unit tests cover `git-version.ts` parsing/comparison (older minor rejected, same minor different patch accepted, newer minor accepted, missing remote git rejected, unreported `undefined` skipped), `bundle.ts` `CHECK_SCRIPT` returning `git`, and `lane-compare.ts` refusing older remote Git under `match-local` and same-machine `remote-key`.
  - `pnpm run lint`, `pnpm run typecheck`, and affected tests + `test/keys/key-format.test.ts` pass.
- **Role**: Use `/worker`.

## 026-28: Record and display remote provenance on failures in `squeal status` and `squeal why`

- **Outcome**: Failures produced by a remote machine record the remote identity (e.g. `agent37:eu:vm:l1l8w0bsw8`, or target label) per `runId` (mirroring `failed-run-loads` with zero schema or key-format changes) and display it in `squeal status` and `squeal why` (both the known-failure line and the `why` history entry).
- **Shape**: slice
- **Spec / context**: Spec 001 D6 (recorded facts) + Spec 026 D12 (honest remote status).
- **Starting seam**:
  1. `src/core/types/runner.ts`: add optional `readonly remote?: string` and `readonly fileRemotes?: readonly { readonly testFile: TestFileRef; readonly remote: string }[]` on `RunReport` (exact parallel to `executedCore` / `fileCores`).
  2. `src/core/daemon/report-merge.ts`: add `remote` and `fileRemotes` merge rules to `MERGE_RULES` (one remote if every part shares it, else per-file `fileRemotes`).
  3. `src/core/runner-host/remote/lane.ts`, `lane-proof.ts`, `daemon-lane.ts`: pass `remoteLabel?: () => string` into `RemoteLaneOptions` (`share.current()?.id ?? target`), tag proven remote reports with `remote: label` (preserved across `joinParts` and `withoutFiles` if needed).
  4. New `src/core/retry/remote.ts` (mirroring `src/core/retry/load.ts`): `RUN_REMOTES_META_KEY = "failed-run-remotes"`, `readRunRemotes(store)`, `recordRunRemote(store, runId, remote)` (capped at 1,024 entries).
  5. `src/core/scheduler/retries.ts` & `src/core/scheduler/record-tier.ts`: when a file records a `fail` result and ran remotely (`remoteOf(report, file.ref)`), call `recordRunRemote(context.store, runId, remote)`.
  6. `src/core/types/status.ts` (`RecordedFacts`, `WhyResultEntry`), `src/core/retry/recorded.ts`, `src/core/retry/text.ts` (`recordedWhereText`), `src/core/status/why.ts`, `src/core/status/format-why.ts`: populate optional `remote?: string` from `readRunRemotes(store)`; when present, render `recorded <ago> on remote <remote> in <where> at revision <rev>, ...` (leaving local runs' wording byte-identical!), and show `remote <remote>` in `squeal why` result history lines.
- **Files owned**:
  - `src/core/types/runner.ts`
  - `src/core/types/status.ts`
  - `src/core/daemon/report-merge.ts`
  - `src/core/runner-host/remote/lane.ts`
  - `src/core/runner-host/remote/lane-proof.ts`
  - `src/core/runner-host/remote/daemon-lane.ts`
  - `src/core/retry/remote.ts` (new)
  - `src/core/retry/recorded.ts`
  - `src/core/retry/text.ts`
  - `src/core/scheduler/retries.ts`
  - `src/core/scheduler/record-tier.ts`
  - `src/core/status/why.ts`
  - `src/core/status/format-why.ts`
  - `test/runner-host/remote/remote-provenance.test.ts` (new) and targeted tests in `test/retry/`, `test/status/`, `test/runner-host/remote/`
- **Leave alone (sibling-owned)**: `package-manager.ts`, `tree-install.ts`, `tree-host.ts`, `bundle.ts`, `connect.ts`, `lane-compare.ts`, `git-version.ts`, `src/runners/process/recorders.ts`.
- **Done when**:
  - Tests prove: a remote failure records `failed-run-remotes`, `squeal status` and `squeal why` (including inherited failures across worktrees and `why` history) name `on remote <id>`, mixed remote+local split tiers tag only remote files, and local-only failures keep byte-identical wording.
  - `pnpm run lint`, `pnpm run typecheck`, and affected tests + `test/keys/key-format.test.ts` pass.
- **Role**: Use `/worker`.
