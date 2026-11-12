# 020-32: the Cezar trial of the existing configuration for its packaged tests (draft diff)

Worker 5180f9e2, 2026-11-12. Brief: `../wave-11.md`, section "020-32". Issue #194; research `../../research/issue-194.md` (case 2, question 5) and `../../research/build-wrapper.md`. Spec 020 D12 (child-process coverage) and D15 (`prepare`). Nothing was pushed. Spec 018's coordinator (3739e45a) opens the Cezar pull request.

Status: survey done; the diff is in progress.

## Survey: the packaged suite on Cezar `origin/main`

Read in a scratch clone `/tmp/w5180f9e2/squawk` of `hearsay-tools/squawk` at `origin/main` `924575538` (nothing written under `~/projects/cezar`).

| # | Question (brief) | Answer | Tag |
|---|---|---|---|
| 1 | Does the suite split into a build plus a plain `node --test` run? | **Yes.** `npm run test:package` runs `node scripts/test-package.mjs`. The script checks that each argument is a `.test.ts` file under `packages/cezar/test/e2e/`. It runs `npm run build` at the repository root when the stamp `node_modules/.cache/cezar-test-package/stamp.json` does not match the build inputs (`needsBuild`). Then it runs `node --import ../../scripts/test-home-env.mjs --import tsx --test <files>` in `packages/cezar`. That is the `argv` and `cwd` of the existing `test:unit` entry in `squeal.config.json`. The script has no build-only mode; the root `build` script ends with `node scripts/test-package.mjs --record-build-stamp`. | read in source code |
| 2 | Does the TypeScript test run under node:test? | **Yes**, through `--import tsx`, as the 12 `test/unit/*.test.ts` files of the `test:unit` entry already do. | read in source code and config |
| 3 | Does `scripts/release.mjs` run unbundled in the child? | **Yes.** `release.test.ts` `runScript` starts `execFile(process.execPath, ['--import', <test/fixtures/release-switch-off.mjs>, scripts/release.mjs, ...args], { env: { ...process.env, ... } })`. The child is a plain Node process that runs the source file itself, and it inherits the test's environment, so `NODE_V8_COVERAGE` reaches it. But `release.mjs` imports `packages/cezar/dist/**/*.js`. Those are `tsc` outputs, one per source file (`sourceMap: true`, `outDir: dist`, `rootDir: src`), and `dist/` is ignored by git. Squeal's child record names the scripts V8 ran (`ownRecord` in `src/core/code/coverage/own.ts`): `scripts/release.mjs` and the `dist` files, not `packages/cezar/src/**/*.ts`. So this test can give child evidence for `scripts/release.mjs` only. Functions in `packages/cezar/src/release/*.ts` keep the evidence of their own Vitest tests (for example `src/release/stable.test.ts`). | read in source code (Cezar, Squeal) |

Other facts found:
- #194's change is cezarion#3297, merged as the single commit `b12aed82b` (parent `d67a30872`), 11 commits behind `origin/main`. It changes 23 files, among them `scripts/release.mjs` (41 lines) and `packages/cezar/test/e2e/release.test.ts` (50 lines).
- The gate reads `prepare` (D15.2) and `coverage.children` (D12.1) at the merge base (`src/cli/code-gate.ts` reads the policy at `mergeBase(root, ref)`). A dispatch of the pull request branch that adds the entry would read `not-prepared` for the packaged files and children off, and that branch changes no function in the packaged suite.
- `npm --prefix ../.. run build`, run in a workspace directory, runs the root `build` script (probe with npm 11.20.0 on a two-package workspace).

## Next

The diff (`cezar-ci.diff`), its checks and the sections "What the diff does", "Files", "What the trial can and cannot show", "Checks run" and "Decisions" follow.
