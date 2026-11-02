# Review: tsrs adoption, 0.1.393

## Verification

Reviewed on 2026-11-02, against D13, ADR 0005, row 010-34 and `tasks/tsrs-review.md`.

```text
git rev-parse HEAD
8ca0eead0948e90ff70560fa9ae70e0c321f5fbe
git rev-parse 6fa27aa86
6fa27aa868b98fbef6c5d5caa6dcdc6982c474d3
git status --short
(empty before verification and after build)
node --version
v24.22.1
pnpm --version
12.15.0
pnpm exec tsrs --version
Version 7.1.0-beta (tsrs 0.20.1-ts7.1.0-beta, microsoft/TypeScript@3e9236361fa9)
pnpm exec tsc --version
Version 7.0.2
```

The dispatch says Cezar already ran `pnpm install --frozen-lockfile` successfully and instructs the reviewer not to repeat setup. It was not repeated. The exact candidate's CI also records successful frozen installs on all four active jobs.

All local checks below ran on the clean candidate, before writing this report:

```text
pnpm run lint
$ biome check .
Checked 2669 files in 1537ms. No fixes applied.
exit 0

pnpm run typecheck
$ tsrs --fast --noEmit
exit 0

pnpm run build
$ tsrs --fast -p tsconfig.build.json && pnpm run build:plugin
$ tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

git diff --exit-code
exit 0, no output
git status --short
(empty)
git diff --check
exit 0, no output
```

One independent compiler-output probe ran `pnpm exec tsc -p tsconfig.build.json --outDir <scratch>` and compared that output with the tsrs-built `dist`. Python enumerated the expected paths and compared bytes for each suffix. It also parsed every tsrs map and checked `sources`, `mappings`, `file` and `version`. The scratch directory was removed in `finally`.

```text
pnpm exec tsc -p tsconfig.build.json --outDir <scratch>: exit 0
Missing expected emitted files: 0
.js files: 862 byte differences: 0
.d.ts files: 862 byte differences: 0
.map files: 862 byte differences: 862
Source maps missing required fields: 0
Total expected emitted files: 2586
```

The map difference agrees with the adoption evidence. Byte identity of source maps is not required. This probe verifies emission and JS/declaration compatibility with the retained TypeScript 7.0.2 compiler; it does not repeat the ADR's upstream-beta benchmark.

### Affected tests

Used `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`, the session's pinned 0.1.390 launcher. Its version notice names Claude Code 0.1.392 and Codex 0.1.390; the reviewed checkout remains 0.1.393.

```text
squeal status --wait 60000 test/helpers/build-inputs.test.ts test/cli/setup/build-outputs.test.ts test/policy/repository-inputs.test.ts test/delivery/delivery.test.ts
Revision: 0
Named test files at revision 0: no known failures; 4 test files, each with a current result, after 2.9 s.
exit 0

squeal status --wait 60000 test/keys/key-format.test.ts test/version-sensitive.test.ts test/delivery/registered.test.ts test/delivery/turn.test.ts
Revision: 0
Run asked: 2 test files were unknown with nothing queued, so this wait asked one run of each at these inputs: test/delivery/registered.test.ts, test/keys/key-format.test.ts.
Named test files at revision 0: no known failures; 4 test files, each with a current result, after 10.0 s.
exit 0
```

An earlier broader status selected 669 files through the changed source/helper paths. It timed out after 64.1 seconds, exit 3: 123 current passing, 78 pending, 468 unknown. The daemon's heartbeat was briefly late, then recovered. The narrower verdicts above establish the relevant test results. The last reported whole-worktree count was no known failures, 1212 of 1385 test files not current (1 running, 58 queued, 1153 unknown). This is not a full-suite pass.

The build-inputs test runs the failed-compile fixture through its nested recorder run. The fixture was not run as a standalone suite. No local full suite or full-suite checkpoint was requested. No uncovered end-to-end test was needed for the compiler selection or setup-parser change; build reproduction and the targeted tests cover the changed behavior.

### CI and limits

Commands: `gh run list --commit 8ca0eead0948e90ff70560fa9ae70e0c321f5fbe --json databaseId,name,status,conclusion,headSha,url`, then `gh run view 41433585897 --json headSha,status,conclusion,jobs`.

[CI run 41433585897](https://github.com/hearsay-tools/squeal/actions/runs/41433585897) is for the exact candidate. At inspection it was **in_progress**: all three Node 22 shards were in their Test step; Node 24 had passed frozen install, lint and typecheck, and was running its version-sensitive tests. Build and bundle checks had not yet run. Nightly and version jobs were skipped as expected on a candidate push. Full-suite CI and cross-Node build reproduction remain **unverified**, not findings. Non-Linux platform execution was not performed locally.

## Verdict

**PASS 8ca0eead0948e90ff70560fa9ae70e0c321f5fbe**

0 blockers, 0 should-fix findings, 0 nits. CI remains pending as recorded above. This review does not supply the exact-release full-suite evidence required by the release policy.

## Blockers

None.

## Should-fix

None.

## Nits

None.

## What fits

- **Compiler selection and strictness:** `package.json:20,25,44` selects pinned tsrs fast mode for build and typecheck. `.github/workflows/ci.yml:108` calls the same typecheck script; both CI build steps already call the build script. `tsconfig.json` and `tsconfig.build.json` are unchanged. TypeScript remains available as the compatibility reference. The lock adds only tsrs and its seven platform packages.
- **Observation and honesty:** `test/helpers/build-inputs.ts:68` appends `--listFiles` to the same fast-mode compiler used by `test/daemon/helpers.ts:71`. Success stats the listed inputs. Failure stats the error's stdout, filters diagnostic lines, then rethrows the original compiler error. The nested recorder tests check the complete source set for successful and failed builds, including `src/core/text.ts` in the failed case. `test/policy/repository-inputs.test.ts` checks that an observed scheduler input changes the daemon test key. No current/stale status rule changed.
- **Setup regression:** `src/cli/setup/build-outputs.ts:128` adds tsrs to the same compiler set as tsc. Its project selection, inherited outDir resolution and explicit output-flag path remain shared. The new test at `test/cli/setup/build-outputs.test.ts:96` removes manifest output clues and requires strong `build-script` evidence for `dist` from the tsrs-only script and tsconfig. Existing tsc fixtures remain intentional.
- **Delivery seam:** `src/core/delivery/delivery.ts:401,476,500` annotates the three destructured parameters with existing `RegisterOptions`, `ToolBoundaryOptions` and `EndTurnOptions`. Public interfaces under `src/core/types` and runtime defaults, argument order, awaits and transaction boundaries are unchanged. Delivery, registration and turn tests have current passing results.
- **Output and packaging:** the independent emit comparison found all expected JavaScript, declarations and maps. The lock includes Darwin arm64/x64, Linux GNU/musl arm64/x64 and Windows x64 optional binaries at the pinned version. The installed launcher resolves its platform package. The compiler stays a development dependency; shipped bundles do not gain a tsrs runtime dependency. All four plugin builds reproduce the committed version 0.1.393 bundles and the Codex runtime manifest without tracked or untracked drift.
- **Scope and style:** no new runner, public option shape or unrelated setup parser was added. The helper rename is complete at real callers. Historical user tsc examples remain. The board and status reflect candidate review; no drift found.

## Inputs for the next wave

No repair row is needed from this review. Keep `compileObserved(args)` as the native test-build boundary: it adds fast mode and `--listFiles`, records inputs on success and failure, and preserves the compile error. Keep CI on the repository scripts. Keep setup's tsc and tsrs paths shared.

The coordinator must read the final outcome of CI run 41433585897 before claiming full-suite coverage. A release still requires passing full-suite CI for its exact release commit and the normal release checks. This review changes no timeout, concurrency or validation budget.
