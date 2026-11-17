# Wave 4: manifests in the Vitest closure

FAIL `9e4ba5b3522570327f6cc2b1c7ee68426248c82d`

Candidate `cand/0.1.542`. **2 proven blockers, 0 should-fix, 0 nits.** Reviewed the three commits above fetched `origin/main`: `ccb5449c6` (manifest implementation), `0a3706fba` (notes), `9e4ba5b35` (version and bundles). Diff base: `e1e2500c64d9b80f94c7740813d6af446f6a3908`. HEAD matched the requested candidate. Lint, typecheck and build passed on a clean tracked tree; all six named Squeal checks are current/pass. Full-suite CI is still in progress. Verification details follow the blockers.

Scope is row 023-14's **manifest part**. The relative shadow-path half is held, as the brief directs. Wave 3 B2 supplies the manifest-retarget failure scenario; this review does not reopen the held commit-key implementation or its other findings.

## Blockers

### B1. Proven: a `#` import into a workspace package omits that package's manifest

**Location:** `src/runners/vitest/resolution-inputs.ts:37` reduces all `#` specifiers to a boolean; `moduleResolutionInputs` at line 152 returns after adding only the importer's nearest manifests when no bare specifier appears in source.

**Contract:** `tasks/wave-4.md`: “a test file whose import resolves through a `package.json` `imports`/`exports`/`main` entry … gets a new key when that manifest entry … changes.” The review brief includes the manifests a `#` import reads. A `#` mapping may point to a bare workspace package, whose `exports` is another resolution input.

**Real-adapter fixture:** The test imports `value` from `#chosen` and asserts `value === "a"`. The root manifest has `"imports": { "#chosen": "@w/shared" }`. `node_modules/@w/shared` links to `packages/shared`. That package contains both `a.ts` (`value = "a"`) and `b.ts` (`value = "b"`), and its manifest has `name: "@w/shared"`, `type: "module"`, `exports: "./a.ts"`.

Run the test through the real scheduler and Vitest adapter: PASS. Stop both. Change **only** `packages/shared/package.json` to `exports: "./b.ts"`. Start lookup-only at the same worktree. It returns the old **current PASS**, with no run. Remove only the fixture's saved closure metadata and start a fresh adapter with `RUN_MISSING`: the test fails, `expected 'b' to be 'a'`.

```text
Initial pass key: c81936382dbc4aace4fcbfb1431c7ede9d5def32343a48c2211425d01b2b639c
Restart key:      c81936382dbc4aace4fcbfb1431c7ede9d5def32343a48c2211425d01b2b639c
Fresh-walk key:   768a2d8f0dde2710cf45114f87450dc20d2872503a51c08161222a5ba9264856
```

The initial closure contains root `package.json`, absent `test/package.json`, `packages/shared/a.ts`, the test and its snapshot path. It contains **no** `packages/shared/package.json`. Even the fresh closure still omits that manifest; only the selected source path changes. Both initial and restart use this candidate, so this is not an upgrade from old metadata.

**One-worker repair:** Preserve the actual `#` specifiers and include every project manifest used along their resolution chain, including a workspace or own-package target's `exports`/`main` manifest. Keep installed packages outside closure paths. Add this regression with the root `imports` unchanged and only the target manifest retargeted. Assert initial current PASS, restart stale, and an independent fresh-run failure. Extend the existing second-worktree and CI-import tests to this chain, with same-content reuse controls. This needs no relative shadow candidates.

### B2. Proven: a workspace subdirectory import omits its nested `main` manifest

**Location:** `src/runners/vitest/resolution-inputs.ts:119`: `bareManifests` returns only `<real package root>/package.json`, regardless of the subpath or manifests below it that select the entry.

**Contract:** The same quoted outcome includes `main`, and the review brief explicitly calls for nested and absent manifests and workspace packages.

**Real-adapter fixture:** The test imports `value` from `@w/shared/sub` and asserts `value === "a"`. `node_modules/@w/shared` links to `packages/shared`. Its root manifest has `name: "@w/shared"`, `type: "module"`, and no `exports`. `packages/shared/sub/package.json` has `type: "module"`, `main: "./a.ts"`. Both `sub/a.ts` and `sub/b.ts` already exist, exporting `"a"` and `"b"` respectively.

Run and stop as in B1. Change **only** `packages/shared/sub/package.json` to `main: "./b.ts"`. The lookup-only restart returns the old **current PASS**. A fresh adapter walk and real run fail with `expected 'b' to be 'a'`.

```text
Initial pass key: d7069fb2a81d49e717275974002bea2d229bf1311998cd554480eb61d5c8d8e3
Restart key:      d7069fb2a81d49e717275974002bea2d229bf1311998cd554480eb61d5c8d8e3
Fresh-walk key:   8292423d4a8f8ee63754672eec6a6063f20fd22b360327157cbc4f59769244f3
```

The initial closure contains `packages/shared/package.json` and `packages/shared/sub/a.ts`, but **no** `packages/shared/sub/package.json`. The fresh closure replaces `a.ts` with `b.ts` and still omits the nested manifest. This retarget adds no source file and involves no held shadow-path behavior.

**One-worker repair:** Record the project manifests actually consulted while resolving a workspace subpath or directory entry, including nested `main` manifests and absent manifest paths that could select a different entry when added. Add the nested `main` retarget above and an absent-to-present nested manifest case. Keep package-root `exports` and `main` controls. Cover restart, second worktree and CI import without putting installed `node_modules` manifests into closures.

## Verification

All product checks and probes ran with HEAD at `9e4ba5b3522570327f6cc2b1c7ee68426248c82d` and a clean tracked tree. Fixture changes were confined to the test helpers' ignored scratch repositories. Probe sources and configuration were outside the worktree and removed before the review commit. No product file was edited. No full suite or full-suite checkpoint was requested. None of the changed tests matches the configured `test/e2e/**` exclusion.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | Exact requested candidate, `9e4ba5b3522570327f6cc2b1c7ee68426248c82d` |
| `git fetch origin`; `git log --oneline origin/main..9e4ba5b3522570327f6cc2b1c7ee68426248c82d` | Exit 0; the three commits listed above. Fetched main was `395a2a8b712e14836d51425b81e241dbb5a93d60`. |
| Dependency setup | Squawk reports `pnpm install --frozen-lockfile` completed in 1 s before launch. Not repeated, as instructed. No install stdout supplied. |
| `pnpm run lint` | Exit 0: `Checked 3601 files in 1477ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: `tsrs --fast -p tsconfig.build.json && pnpm run build:plugin`; builds for Claude Code, Codex, Pi and OpenCode completed. `git status --short` stayed empty. |
| `git diff --check origin/main...HEAD` | Exit 0, no output |
| Squeal affected-source wait below | Exit 3 after 64.2 s: 637 selected test files; 53 current/pass, 40 pending, 544 unknown. No known failures. Broader affected coverage is **unverified**. |
| Squeal six named tests below, final wait | Exit 0: `Named test files at revision 0: no known failures; 6 test files, each with a current result, after 4.6 s.` Whole worktree: 691/1911 test files not current (43 queued, 648 unknown). This includes content-key reuse, not a fresh full-suite claim. |
| External five-case proof below | Exit 1: **3 passed, 2 failed**, 7.39 s. The two failed assertions are B1 and B2's false current passes. Each first established a pass, then independently established a real failure at the changed resolution. |
| External probe setup attempt | Exit 1 before collecting tests: wrong helper import `test/scheduler/policy.ts`. Corrected to `test/helpers/baseline.ts` before the five-case proof. No product defect inferred. |
| Read-only closure scan, `pnpm exec tsx <scratch>/rekey.mjs` | Exit 0. Current-present stored paths: Squeal 1,928, 44 possible additions through declared fixture inputs, **0 walked-module additions**; squawk 1,902, **109** lists would add manifests. See method below. |
| `gh run view 44044583542 --json headSha,status,conclusion,jobs` | At 08:25 UTC on 2026-11-17: exact candidate; Node 24 lint/typecheck/version-sensitive/build job passed. Six Node 22/26 shards still **in progress**. Full-suite CI is **unverified**, not a blocker. [CI run](https://github.com/hearsay-tools/squeal/actions/runs/44044583542). Private-material run `44044583622` passed. |

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  src/runners/vitest/resolution-inputs.ts src/runners/vitest/adapter.ts \
  src/runners/vitest/glob-listing.ts \
  test/runners/vitest/resolution-inputs.test.ts \
  test/integration/resolution-inputs.test.ts test/ci/resolution-import.test.ts \
  test/keys/key-format.test.ts test/version-sensitive.test.ts test/runners/boundaries.test.ts

"$SQUEAL" status --wait 60000 \
  test/runners/vitest/resolution-inputs.test.ts \
  test/integration/resolution-inputs.test.ts test/ci/resolution-import.test.ts \
  test/keys/key-format.test.ts test/version-sensitive.test.ts test/runners/boundaries.test.ts

# Run through `hsq job start review-manifest-probe --`:
timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs
```

**Proof method:** One external Vitest file imports `createRepo`, `openRepoStore`, `openHarness` and `RUN_MISSING` from the existing helpers. Restrict each fixture to `test/review.test.ts`. At each start await `scheduler.start()` and `quiet()`. Read `sink.stateOf`, `keyOf` and the saved closure paths. Close scheduler and adapter before changing the manifest. Restart with lookup-only policy, save the state and key, then close. Remove only `store.testFiles` metadata for the fixture test to require a fresh closure walk, retaining all stored results. Start with `RUN_MISSING`, record its failure and new key, then close. Cleanup closes stores and removes fixtures. The three passing controls use the same method: direct workspace `main` retarget, own-package `exports` retarget, and addition of a nearer manifest for a direct `#` import.

**Re-key method:** Read `test_files` from both live stores through SQLite `mode=ro`, filter to test paths still present, and call this candidate's `moduleResolutionInputs` with Vitest's `parseAst` once per unique source path in those closure lists. Count lists missing any returned manifest. Squeal's positive modules are under `test/fixtures/node-test/**`, declared inputs rather than Vitest-walked modules. The 44 is therefore an upper bound from scanning declared content, consistent with the worker's 0 walked tests. Squawk was still at `fd1e7f658e09e65b2550dcf655a5934c1ffdbca6`; 109/1,902 agrees with the worker. This checks closure-path additions, not a fresh daemon key census; it does not certify unmodelled resolver chains such as B1/B2.

## Should-fix

None beyond the blockers.

## Nits

None.

## What fits

- The direct root `#` retarget now prevents restart reuse. Undo reuses the original pass without running. The integration test also proves a same-commit second worktree inherits the pass and a retargeted worktree does not.
- The CI-import test is current/pass. It records and exports with real evidence, imports both passes at the same commit, and refuses the direct `#` test's old pass after a manifest retarget while retaining the unrelated test's pass.
- Direct workspace `main`, own-package `exports`, and adding a nearer `#` manifest passed the independent real-adapter controls. The unit test covers intermediate absent manifests in the nearest walk.
- An installed package stays outside project closure paths. `WorktreePaths.isProjectFile` rejects `node_modules`, the unit test checks a pnpm-style installed link, and the validity case includes a real installed package. Installed-dependency keying remains the owner of installed packages.
- `KEY_FORMAT_VERSION` and adapter versions did not move. The named key-format test passes; the added validity case covers the changed adapter path with `#`, own-package and installed imports. Adding closure inputs changes keys instead of changing the meaning of a stored result at an equal key. No global raise is justified by this change.
- The product boundary holds: no core commit lookup, checkout, scheduler, delivery or status code changed. `glob-listing.ts` exports its existing parser helpers without changing behavior. The runner-boundary test passes and rebuilt bundles match the committed files.
- Existing closure records from an earlier release gain inputs only when walked again, as the worker notes state. Neither blocker depends on that rollout window. Both first stored their pass with this candidate.
- The held shadow half, tsconfig `paths`, relative `require` and setup/globalSetup manifest tracking remain outside this assigned slice. This verdict does not require them.

## Inputs for the repair and next wave

Repair B1 and B2 in one owned slice, or sequentially: both change `resolution-inputs.ts`. Keep the adapter-to-core interface unchanged: `resolutionInputs(project, graph, paths, parse)` returns absolute project manifest paths, and `closure()` adds them before converting to relative paths. The core already hashes present and absent paths. Record manifests from the actual resolution chain; a source-level name alone does not prove which manifest selected a target.

The repair must retain direct `#`, own-package and workspace-root controls, plus installed-package exclusion. Add retarget and undo, nested absent-to-present, same-content second-worktree reuse and CI-import controls for the repaired chains. CI export must retain evidence for every added path; do not trade a false pass for silently exporting no useful results. Use `timeout 600` on direct Vitest commands and Squeal affected waits; do not request a full suite. Recheck key-format and runner boundaries, rebuild the candidate bundles and repeat the small re-key measurement. Keep the shadow-path evidence work separate.

The coordinator still needs exact-candidate full-suite CI before release. Pending CI and the unknown affected files are verification limits, not additional findings.
