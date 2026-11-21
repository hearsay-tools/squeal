# 011-425: who reads the root `package.json` in this repository's tests

Worker notes, row 011-425, wave 127 (brief `../wave-127.md`). Survey first, then the slice. Base `66c4223bf` (Squeal 0.1.591), Node 26.13.0, Vitest 5.0.3, Vite 8.3.2. Evidence tags follow `docs/process.md`.

## Summary

- **Before:** `squeal reach package.json --json` at base: 911 of 2,105 test files, 5,484 of 7,370 recorded seconds; 910 through a runtime read, 1 through a declared input (`test/harness/plugin.test.ts`). *Verified by experiment.*
- **The cause is two readers, not one.** In a sample of 45 of the 910 files run alone under Squeal's recorder, all 45 recorded the root `package.json`. 30 read it through `squealVersion()` in the Vitest worker, and 20 through Vite's PostCSS config search in the worker, which walks up from a fixture under `test/fixtures/` to the repository root. By seconds the second reader is larger: 217 s of the sample's 364 s against 171 s. *Verified by experiment.*
- **After:** 1 of the 45 sampled files still records it (2 of 364 s): `test/harness/codex/version-copies-start.test.ts`, which builds a plugin bundle and reads the manifest on purpose. Extrapolated by size class to the 910: about 22 files and 44 s. The sample can miss rare readers. A static count of the 910 files that import a bundle build or a manifest reader directly gives 49 files and 161 s, an upper bound for that kind. So a version-only edit re-keys about 20 to 60 test files and 50 to 200 recorded seconds, from 910 files and 5,482 s. *Verified by experiment (sample, section 6); extrapolation and bound inferred.*
- **No change under `src/`.** The worker gets a fixed version through Vitest's `define`. `buildCli` writes a manifest with that version. The helpers and tests that start Squeal from the sources in a child give it the same global through an `--import` of a `data:` URL in its Node arguments. `squealVersion()` already reads `__SQUEAL_VERSION__` as a global when one is set, which is also how Vitest applies `define`. An empty PostCSS config in `test/fixtures/` stops Vite's search there.
- **Tests that need the real version keep reading it.** Raising only the `version` line in a copy fails 3 tests of `test/harness/plugin.test.ts`, as before (section 4).

## 1. Method

- **Before count.** `squeal reach package.json --limit 2000 --json` in this worktree. The 910 runtime-read files and their seconds are in `probes/files.tsv`.
- **Store signatures.** I read `test_files.closure_paths` from the main store with a read-only connection (`node:sqlite`, `readOnly: true`). The 8.5 GB store was not copied, because no `sqlite3` binary is installed here. The closures do not record which process made a read, so they cannot tell a worker read from a child read.
- **Probe.** `git archive HEAD` of base into a scratch directory, with a copy of `node_modules`. `probes/run-obs.sh` runs each test file alone with `node_modules/.bin/vitest run <file>` and a 400 s timeout. Two preloads are in `NODE_OPTIONS`: Squeal's own recorder (`src/runners/observe/recorder.cjs`, `SQUEAL_OBSERVE` with the copy as root, per-file output), and `probes/tracer.cjs`. The tracer logs each access to the root `package.json` with the process (Vitest's main process, a worker, or a child) and the caller's stack. Reads in Vitest's main process are not attributed to a test file, so `probes/classify.cjs` drops them, as the recorder does.
- **Sample.** `probes/sample.txt` has 45 files, chosen by path hash within three size classes of the 910: 25 of the 553 files under 3 s, 15 of the 291 files from 3 to 20 s, and 5 of the 66 files of 20 s or more. One file at a time. One-minute load was 15 to 17 on 24 CPUs, which is the host's real load.
- **Results.** `probes/before.txt` (base) and `probes/after.txt` (the committed slice). Columns: `R` when the recorder recorded `package.json`, the exit code, the stored seconds, the file, and the readers the tracer saw.

## 2. Readers at base

Files of the 45-file sample with each reader. One file can have several readers.

| Reader | Process | Files | Stored s | Removed by |
|---|---|---|---|---|
| `squealVersion()` (`src/core/daemon/version.ts`), from the daemon, the CLI, hooks and keying | worker | 30 | 171 | `define` in `vitest.config.ts` |
| Vite's PostCSS config search (`postcss-load-config`, stop at the workspace root): `access` and `readFile` of each `package.json` from a fixture under `test/fixtures/` up to the root | worker | 20 | 217 | `test/fixtures/postcss.config.mjs` |
| `buildCli` copies the root manifest beside its private `dist` (`test/daemon/helpers.ts`) | worker | 4 | 40 | writes a manifest with the test version |
| `squealVersion()` in a child that runs `src/cli/index.ts` through tsx (the `status --at` relaunch) | child | 3 | 78 | `VERSION_ARGS` in `RELAUNCH` (`test/cli/status-at-kit.ts`) |
| `nodeFloor()` (`src/harness/build.ts`) of a plugin bundle build | worker | 1 | 2 | kept: a real dependency |
| Not seen by the tracer: a child with an environment of its own (`{ PATH, HOME }` or `childEnv`), which loses the tracer from `NODE_OPTIONS` but gets Squeal's recorder through `spawn.cjs` | child | 3 | 20 | `VERSION_ARGS` at the spawn |

Combinations: `squealVersion` only 16 files (24 s); PostCSS search only 13 (188 s); both 7 (29 s); `buildCli` + `squealVersion` 4 (40 s); child + worker `squealVersion` 3 (78 s); `nodeFloor` 1; not traced 1. Two of the files counted under the worker kinds also start such a child (`revert-restore`, `optimizer-start`). *Verified by experiment.*

**The whole 910, by store signature** (read-only store query; signature only, process not known). 382 of the 910 files, 3,331 s, have the PostCSS search places (`.postcssrc` and the other names) at the repository root in their closure. 15 files (29 s) have no sign of either reader. *Verified by experiment (store query); reader attribution inferred.*

**The brief's other candidates.** Node's own `type` lookup reads `package.json` in C++, and the recorder does not see it: no stack in the trace comes from it. A build was the reader in 1 file. A test's own read: `test/harness/version.test.ts` reads it on purpose. Vite's workspace-root search (`searchForWorkspaceRoot`) stops at `pnpm-workspace.yaml` at the root before it reads `package.json`, and its `existsSync` calls ran only in Vitest's main process in the sample. *Verified by experiment.*

**A store record no solo run makes.** `test/plugins/codex/hooks-json.test.ts` holds `package.json` in its stored closure, but a solo run under the recorder records no read of it. Its stored closure also holds `.claude-plugin/marketplace.json`, which no module it imports reads. Under the daemon, several files share a worker one after another, so a late read from an earlier file can be recorded against the next file. I did not chase this further. *Verified by experiment (solo run); cause inferred.*

## 3. Tests that must see the real version

These read the root `package.json` on purpose and keep the dependency:

- `test/harness/plugin.test.ts` (a declared input in `squeal.config.json`): plugin, marketplace and package versions in step; committed bundles equal to a build; the bundled CLI prints the root version.
- `test/harness/version.test.ts`: `manifestVersion` of the sources is the root version (its own read).
- Bundle and plugin builds through `src/harness/build.ts` (`rootVersion`, `nodeFloor`): `test/harness/codex/version-copies-*`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`, `test/e2e/shipped-plugin.test.ts`, `test/cli/main.test.ts`, `test/harness/plugin-data-claude-code.test.ts`, `test/daemon/lifecycle.test.ts` (these import `rootVersion` or read the manifest).
- `test/harness/opencode/*` through `manifestFloor` (`src/harness/opencode/host.ts`): the Node floor, not the version, but the same file.

## 4. The slice

- `test/fixed-version.ts`: `TEST_VERSION = "0.1.600"` and `VERSION_ARGS`, the Node arguments `--import data:text/javascript,globalThis.__SQUEAL_VERSION__='0.1.600'`. A `data:` URL means no file is read.
- `vitest.config.ts`: `define: { __SQUEAL_VERSION__: JSON.stringify(TEST_VERSION) }`. Vitest sets defines as globals in the worker at run time. `typeof __SQUEAL_VERSION__` in `version.ts` then reads `"string"`.
- `test/daemon/helpers.ts`: `buildCli` writes `{ name: "squeal", version: TEST_VERSION, type: "module" }` instead of copying the root manifest. Its daemons report the worker's version, and a test that wants an older daemon still writes its own manifest.
- `test/runner-host/process-helpers.ts` (`SOURCE_LAUNCH`) and `test/runner-host/source-launch.test.ts`: the runner host from the sources gets `VERSION_ARGS` before `--import tsx`. A host refuses a daemon of another version, and these tests pair a host child with the worker's daemon.
- `test/runner-host/remote/helpers.ts`: the remote test's bundle is built with `__SQUEAL_VERSION__` set to `TEST_VERSION`. The build still reads the manifest for the Node floor.
- `test/daemon/lifecycle.test.ts`: the daemon record holds `TEST_VERSION`, not `rootVersion()`.
- `test/cli/status-at-kit.ts` (`RELAUNCH`, the `--run` child of every `status --at` test, 40 of the 910 files and 761 s), the daemons the integration tests start from the sources (`test/integration/{capacity-project,node-test-packages,node-test,optimizer-start,revert-restore,slow-spawn}.test.ts`, `pytest-repo.ts`, `wait-daemon.ts`) and the CLI children of `test/cli/code-gate-{json-stdout,keep-kill,keep-stop,kill-parent,prepare-cancel}.test.ts` and `test/cli/status-{paths,wait}-paused.test.ts`: `VERSION_ARGS` before `--import tsx`. A SessionStart hook in the worker treats a daemon of an older version as one to replace. `test/integration/node-test.test.ts` and `test/integration/pytest.test.ts` timed out waiting for the baseline while their daemons from the sources reported 0.1.591, and both pass with the change (Squeal's runs at revisions 18 and 25).
- `test/fixtures/postcss.config.mjs`: an empty PostCSS config. The search of every fixture under `test/fixtures/` (including `scheduler/.tmp` and `vitest/.tmp`, where the daemon tests' repositories live) stops there.
- `test/harness/version.test.ts`: "is the root package version when run from the sources" now asks `manifestVersion` of `src/core/daemon/version.ts`. A new case checks that `squealVersion()` is `TEST_VERSION`. `test/fixed-version.test.ts` checks the worker's version, and that a process started with `VERSION_ARGS` has it and one started without them has none.

**Not through `NODE_OPTIONS`.** The first form put the `--import` in `NODE_OPTIONS`: in the global setup, then in a worker `setupFiles` entry, and in `childEnv`. Under Squeal's daemon the global setup's change did not reach the workers. The worker form reached every child, but the re-run failed 19 checks in 11 files. Squeal's node:test support reads `NODE_OPTIONS` in the projects it runs, and it reported the extra loader ("unrecognized loader \"data:text/javascript,…\" in argv or NODE_OPTIONS") or left out CI parts for their flags (`test/ci/export-node-test-parity.test.ts`, `test/cli/code-gate-prerun.test.ts`, `test/runner-host/idle-host.test.ts`, `test/integration/node-test-packages.test.ts`, `test/runners/node-test/ci-record-inherited.test.ts`). In `childEnv` it also overrode the manifest that the step-down tests use to start an older daemon (`test/daemon/handover*.test.ts`, `test/daemon/start-short.test.ts`). A variable the product reads is no place for a test seam. Every one of the 19 checks passes with the committed form. *Verified by experiment (Squeal's runs at revisions 15 and 17).*

**Why a fixed value, and why `0.1.600`.** If the value followed `package.json`, a raise would change test results with no key change. Some worker tests compare `squealVersion()` with versions a child process reports. With the worker fixed and a child on the real version, those tests fail. The children that pair with the worker therefore get the same value, and the fixed value shows each such pair now: `test/runner-host/source-launch.test.ts` and `test/runner-host/remote/connect.test.ts` failed with "runner host of Squeal 0.1.591 (protocol 1) refuses a daemon of Squeal 0.1.600" until their helpers gave the host the test version. Tests write older versions as `0.1.x` literals up to `0.1.451` and newer ones from `0.1.899` up, and as `9.9.9` and `999.0.0`. `0.1.600` keeps that order, and it differs from 0.1.591, so a test that mixes the fixed and the real version fails now. *Inferred; the sample's 45 files pass with `0.1.590` as at base.*

**Real-version tests still catch a wrong version** (done-when 2). In the probe copy with the slice, only `"version": "0.1.591"` raised to `"0.1.592"` in `package.json`, I ran `vitest run test/harness/plugin.test.ts test/harness/version.test.ts` (timeout 300 s): 3 failed, 18 passed.

```
× keeps the plugin, its marketplace entry and both package versions in step
  AssertionError: expected '0.1.591' to be '0.1.592'
× are committed exactly as `npm run build` produces them
  AssertionError: cli/squeal.mjs differs from the build: expected false to be true
× give the CLI the root version with no manifest anywhere near it (B1)
  AssertionError: expected '0.1.591\n' to be '0.1.592\n'
```

*Verified by experiment.*

## 5. What stays

- **Children started from the sources without `VERSION_ARGS`**, left as they are: the CI record children (`test/ci/endpoints-child.test.ts`, `test/ci/record-exit.test.ts`, `test/cli/ci-usage.test.ts`), whose Node flags the recorded parts hold; the Codex adapter and runtime-update children (`test/harness/codex/adapter/*`, `test/harness/codex/runtime-update/*`); the hook runners (`test/harness/hand-off.test.ts`, `test/harness/subagent-leaving.test.ts`); and the child entry scripts `test/cli/proof-cli-child.ts`, `test/cli/status-at-cli-child.ts` and `test/commit/at-keys-killed.test.ts`. A child entry runs Squeal at the real version, so its relaunch must too. They read the real version and re-key on a raise, as they should while they read it.
- **Bundle builds and `manifestFloor`** read the root manifest for real.
- **Cross-file attribution** in shared workers (section 2) can put `package.json` back into a closure whenever an earlier file's read lands late.

## 6. After

**Not from the store.** Each test file has one stored closure (`test_files`, keyed by project and path), and the worktree that ran it last writes it. Within 30 minutes of this branch's commit, another worktree on the old configuration wrote 1,718 of the rows, and this worktree wrote none. So the store cannot say what this branch's runs record. `squeal reach package.json` will show the change once main and the live worktrees run it. *Verified by experiment (read-only store query).*

**The probe on a copy.** Same method and sample as section 1, on `git archive` of the slice, run on 2026-11-22 at one-minute load 22 to 24 on 24 CPUs (`probes/after.txt`):

| | Files recording `package.json` | Their stored s |
|---|---|---|
| Before (base `66c4223bf`) | 45 of 45 | 364 |
| After (this slice) | 1 of 45 | 2 |

The one file is `test/harness/codex/version-copies-start.test.ts` (`nodeFloor` of a bundle build). Every file exits as at base. `test/cli/code-gate-prerun.test.ts` fails in the copy at base and after, as it does not in the worktree. By size class: under 3 s, 1 of 25 left; 3 to 20 s, 0 of 15; 20 s or more, 0 of 5. *Verified by experiment.*

Command, per sampled file: `PROBE=<dir> probes/run-obs.sh <label> probes/sample.txt`, then `node probes/classify.cjs <dir>/<label>`. The copy needs `git archive` of the commit, a copied `node_modules` and a `git init`.
