# Spec 024: test-only CI fix review

## Verdict and verification

**PASS 99856e4ab88d5b4c91d23e5f3147f5d8d86a96b5.** Blocking: 0. Should-fix: 0. Nits: 0.

Reviewed on 2026-11-23 against base `d2e55574857534b33abdba411f7efa8a876bb92e` (0.1.603). All verification below ran at the exact candidate on a clean tree, before this review file was added. Node `v26.13.0`; pnpm `12.15.0`. Dependencies were already installed by Squawk; the brief explicitly said not to repeat installation.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `99856e4ab88d5b4c91d23e5f3147f5d8d86a96b5` |
| `git status --porcelain` | Empty output before verification and after build. |
| `git diff --stat d2e55574857534b33abdba411f7efa8a876bb92e 99856e4ab88d5b4c91d23e5f3147f5d8d86a96b5` | Two existing test files; 2 insertions, 1 deletion. |
| `git diff --exit-code d2e55574857534b33abdba411f7efa8a876bb92e 99856e4ab88d5b4c91d23e5f3147f5d8d86a96b5 -- src plugins package.json pnpm-lock.yaml` | Exit 0; empty output. No source, plugin, version or dependency changes. |
| `pnpm run lint` | Exit 0. `Checked 4061 files in 1982ms. No fixes applied. Found 1 warning. Found 2 infos.` Diagnostics are in unchanged `test/ci/endpoints.test.ts` and `test/code/gate/parts.test.ts`. |
| `pnpm run typecheck` | Exit 0. Ran `tsrs --fast --noEmit`; no diagnostics. |
| `pnpm run check:private` | Exit 0. `private: 2 added lines in 2 files over d2e55574857534b33abdba411f7efa8a876bb92e, ok`. Warning: `SQUEAL_PRIVATE_DENYLIST` is empty, so its denylist rule was skipped. |
| `GOMAXPROCS=2 pnpm run build` | Exit 0. Ran the TypeScript build and all five plugin builders, including Antigravity. |
| `git diff --exit-code -- plugins` | Exit 0; empty output. `git status --short --untracked-files=all` was also empty after build. |
| `git diff --check d2e55574857534b33abdba411f7efa8a876bb92e 99856e4ab88d5b4c91d23e5f3147f5d8d86a96b5` | Exit 0; empty output. |
| `cmp plugins/claude-code/bin/squeal-launcher plugins/antigravity/bin/squeal-launcher` | Exit 0; byte-identical copies. |
| `~/.codex/plugins/data/squeal-hearsay/bin/squeal checks` | Default `tests` check covers both named test files and runs after edits. |
| `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/node-floor.test.ts test/harness/codex/packaging/runtime.test.ts` | Exit 0. Squeal queued both files because they were initially unknown. `Named test files at revision 0: no known failures; 2 test files, each with a current result`. |
| Same path wait with `--json` | Selection `outcome: settled`, `code: 0`, `result: pass`, `complete: true`. Both named files have `state: current`, `verdict: pass`; pending, stale, unknown and failure counts for this selection are all 0. Snapshot head is the candidate; `dirty: null`; daemon is alive. |

The Squeal results are for the two named files, not the full suite. The final snapshot had 2,053 other test files not current. No local full suite or `squeal run --all` was requested or run.

### Available CI

`gh run list --commit 99856e4ab88d5b4c91d23e5f3147f5d8d86a96b5 --json databaseId,name,status,conclusion,headSha,url --limit 20` returned:

- [Private material, run 45086138320](https://github.com/hearsay-tools/squeal/actions/runs/45086138320): completed, success, exact candidate.
- [CI, run 45086138280](https://github.com/hearsay-tools/squeal/actions/runs/45086138280): in progress, exact candidate. The latest `gh run view 45086138280 --json status,conclusion,jobs` still showed the Node 22 and Node 26 shards and Node 24 job in progress. Full-suite CI is **unverified** at review time. This is not a finding or a claimed pass.

## Blocking findings

None.

## Should-fix findings

None.

## Nits

None.

## What fits

- `test/node-floor.test.ts:98` adds the existing Antigravity launcher in sorted order. Spec 024 D1 requires `bin/squeal-launcher` to be copied from the Claude Code launcher. The base already tracks this file, and the copies are byte-identical. The assertion still checks the exact launcher inventory. The following assertion still requires every launcher to state the Node floor, and the separate floor check still rejects inconsistent versions.
- `test/harness/codex/packaging/runtime.test.ts:187` adds the existing Antigravity builder to the exact expected `build:plugin` string. Spec 024 D5 explicitly includes `package.json` (`build:plugin`) in the adapter wiring. The root script at both base and candidate already contains this builder in that order. The test retains the existing four builders and its exact equality check.
- These updates repair stale expectations for the files shipped in 0.1.603. They do not change production behavior, delivery state, interfaces, budgets or test selection. The build produces no committed or untracked plugin drift. No performance benchmark is required for this test-only range.

## Inputs for the coordinator and next wave

No fix wave is needed for this range. This PASS covers only the two expectation updates; it does not re-review the Antigravity implementation or establish live proof for Wave 3. Read the final result of CI run 45086138280 before landing under `docs/process.md`; release still requires passing full-suite CI at the exact release commit.
