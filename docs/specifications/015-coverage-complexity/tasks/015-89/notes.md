# 015-89 notes: coverage off by default again

Worker d5585ef2 (slice, cut short by usage limits) and finishing worker 98cabe1f, 2026-10-26 to 2026-10-27, from `tasks/wave-18.md` W1. Baseline `3c6d3201b` (main after 0.1.359; the brief said 0.1.358, and 0.1.359 changed no coverage code). The human, 2026-10-26: "OK, off by default for now".

## What changed

| Part | Change | Where | Test (red first) |
|---|---|---|---|
| Lead | `DEFAULT_POLICY.coverage.enabled` is `false`. `coverage.untested` and `crap.enabled` stay `true`: they act only under `coverage.enabled`. Complexity stays on by default. The type's comments name node:test runs and the row. | `src/core/types/policy.ts` | `test/code/policy.test.ts`, `test/types.test.ts` (the default's shape) |
| Default off | A project whose `squeal.config.json` does not set `coverage.enabled` (no code key at all, or `coverage` without `enabled`) makes no coverage step, keeps only `complexity` states and no coverage summary, and its registration's code line has no coverage sentence. With `"coverage": { "enabled": true }` the step runs, `crap` and `uncovered` states and the summary are kept, and the line has 0.1.358's sentence. Each reads the file through `loadPolicy`, as the daemon and the hooks do. | `test/code/crap/default-off.test.ts` | red with the old default: an unset config then makes one step and keeps `crap` and `uncovered` |
| Keys | A project without the setting keys its checks as one with `coverage.enabled: false`; `true` adds only Squeal's marker `{ provider: "squeal", version: COVERAGE_PROVIDER_VERSION }`. The adapter takes `coverageOn(loadPolicy(root).policy)`, as `daemon.ts` hands it over. | `test/runners/vitest/coverage-default.test.ts`, `test/runners/node-test/coverage-default.test.ts` | red with the old default: an unset config then carries the marker |
| Tests that assumed the default | The coverage rig (`rig.ts`) writes `coverage: { enabled: true }` beside complexity, at creation and in `configure`; the status cases that switch one check off set `coverage.enabled: true` themselves. The code-off helpers' comment says the default is off again. | `test/code/crap/{rig.ts,status.test.ts}`, `test/helpers/policy.ts` | |
| Words | The three skill copies of `references/policy.md` (source `plugins/claude-code`; `test/harness/skill.test.ts` keeps the Codex and Pi copies identical): default `false`, the opt-in line `"coverage": { "enabled": true }`, and "its own Vitest and node:test runs" (D8 **node:test**); a switch re-runs each Vitest and node:test file once (D8 **Keys**). | `plugins/{claude-code,codex,pi}/skills/squeal/references/policy.md` | |

This repository's `squeal.config.json` keeps `"coverage": { "enabled": true, ... }` and complexity on; unchanged.

## The contracts, and what checks each

- **Default off.** `default-off.test.ts`, three cases for the two unset forms.
- **Explicit on behaves as 0.1.358.** `default-off.test.ts`'s `true` case for the step, the states and the sentence. The rest of 0.1.358's coverage behaviour is the existing coverage tests: every coverage test either uses `coverageRig` (which now turns coverage on), passes its own policy with `enabled: true`, or drives the adapter's `coverage.enabled()` directly. A search of `test/` for coverage tests that write a config without `enabled: true` found none that relied on the default: `catch-up-daemon`, `corrupt` and `pass/daemon` set `false` already, and the rest use the rig.
- **Keys equal 0.1.358's with `coverage.enabled: false`.** Two links. (1) Unset equals `false`: the two `coverage-default` tests. (2) `false` equals the release before: for node:test the validity case "a run with coverage off keeps the last release's keys and outputs (row 015-86)"; for Vitest `test/runners/vitest/own-provider.test.ts` "keys a coverage-on instance by the provider's name and version alone, and coverage off as before" (coverage off equals an adapter with no coverage), and the Vitest validity cases. The validity harness drives coverage directly (`input.coverage`), not through the policy, so the default cannot change what it compares; no `compare-refs` run was made for this row.
- **Why two key test files.** `test/version-sensitive.test.ts` flags a test file that creates the node:test adapter unless `test/version-sensitive.txt` selects it; the node:test half sits under `test/runners/node-test/`, which the list selects, so it runs on Node 24 too, and the list is unchanged.

## Proposed spec text

D1, the `coverage.enabled` row:

> | `coverage.enabled` | `false` | Wave 2, D8. Needs `complexity.enabled`. Default `false` again since 2026-10-26 (the human, after 015-14 part B: "OK, off by default for now"; row 015-89); `true` from 0.1.341 until then. A project turns it on with `"coverage": { "enabled": true }`; this repository does. |

D1, after the table's paragraph on checks set while coverage is off, no change: "`coverage.untested` or `crap.enabled` set while `coverage.enabled` is off does nothing, and status says so once" already holds for the default, since status names only the checks the file sets.

## For the coordinator

- **One re-key at upgrade.** A project that does not set `coverage.enabled` held Squeal's marker in its Vitest and node:test keys from 0.1.341 (node:test from 0.1.358). Upgrading to this release turns its coverage off, so every Vitest and node:test check of such a project re-keys once and its files run again (D8 **Keys**: turning coverage on or off re-keys once). Keys return to their form before 0.1.341, so results stored then at the same content would match again, but `store.retentionDays` (7) has likely pruned most. This repository sets `coverage.enabled: true`, so here nothing re-keys. The release notice could say so.
- **Bundles.** `test/harness/{codex/plugin,opencode/package,pi/package}.test.ts` fail "has the bundles exactly as `npm run build:plugin` produces them" (`cli/ps.mjs differs from the build`), since the bundles hold `DEFAULT_POLICY`. The brief says no bundles; the release build fixes it.
- **Spec Goal 1** still reads "Off by default. With `complexity.enabled` unset or `false`, Squeal counts nothing …", which has been wrong for complexity since 015-64. Not this row's text; named for the next spec edit.
- **History.** The previous worker's skill copies were saved by cezar's autosave `a638df354` (still on `origin/wip/015-89`). This branch replaces it with `04e3659f2`, a commit with the same content and a row-named message.

## Coordinator release verification (2026-10-27)

Released `squeal--v0.1.361` from `1815c57e5b2e00f55aa001fb1349cec5b31ca0f3`. Candidate `bf344940c` passed review with zero findings (`reviews/0.1.361.md`); its product files equal the release commit's. Intervening changes were documentation only.

| Command or evidence | Actual result |
| --- | --- |
| `npm run build` | Exit 0; bundles committed with 0.1.361. Exact-release CI also passed build and bundle-drift checks. |
| `npm run lint`; `npm run typecheck` | Both exit 0; lint checked 2,377 files, no fixes. |
| `npm run check:version -- origin/main` before landing | Exit 0; 0.1.359 to 0.1.361. |
| `npx vitest run` with `test/keys/key-format.test.ts`, `test/version-sensitive.test.ts`, `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`, `test/code/crap/default-off.test.ts`, `test/code/policy.test.ts`, `test/code/crap/status.test.ts`, `test/runners/node-test/coverage-default.test.ts`, `test/runners/vitest/coverage-default.test.ts`, `test/types.test.ts` | 12 files, 95 tests passed. |
| Reviewer targeted commands in `reviews/0.1.361.md` | Node 24: 10 files, 83 tests passed. Node 22.19.0: 2 files, 8 tests passed. |
| Pre-tag `npx vitest run test/keys/key-format.test.ts` | 1 file, 12 tests passed. |
| Candidate full CI 40420823494 | Passed on exact candidate `bf344940c`. |
| [Main full CI 40424484690](https://github.com/hearsay-tools/squeal/actions/runs/40424484690) | Passed all required jobs on exact release `1815c57e5`; Node 22 full-suite shards, Node 24 version-sensitive checks, lint, typecheck, build, bundle drift and version guard. |
| Final `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/core/types/policy.ts test/code/crap/default-off.test.ts test/runners/node-test/coverage-default.test.ts test/runners/vitest/coverage-default.test.ts test/harness/opencode-dispose.test.ts` | Exit 3 at revision 9 (`be58dcc5`): 1,013 selected files; 1,007 pass, 1 fail, 5 pending. Whole worktree: 18 of 1,232 files not current. The failure is the OpenCode dispose deadline race (+2003 ms at a 2000 ms deadline), fail/pass/fail under the same tracked inputs. Its load retry passed, then another background run failed. Candidate and exact-release CI passed that file in its separate step. No clean local broad pass is claimed. |
| `claude plugin tag plugins/claude-code --push` | Tag pushed at exact release SHA. |
| Hub `claude plugin validate .` | Passed; both manifest pins pushed as `22a78ad`. |
| `gh release create squeal--v0.1.361 … --verify-tag --latest` | Published latest release with `install.sh` from the tag. Asset SHA-256 `76764c47f543e379312b67c26e03366d2bfe14f0d7ed00b70a80fa6945dcd527` matches the tagged file. |

No local full suite ran. Exact-commit CI supplies the full-suite release evidence. Both owned workers were collected and destroyed; the release notice is cleared.
