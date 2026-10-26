# 017-03: notes for the next rows

Worker f2e5cb23, 2026-10-26. The lint check's data layer, with no ESLint and no daemon wiring. The design was approved by the coordinator (605ca21e) before the build, with the seven defaults below.

## Seam map

| File | What it holds |
| --- | --- |
| `src/core/types/lint.ts` | `LintCheckId` `(path, tool)`, outcomes, `LintFinding`, `LintResult` (shared), `LintJudged` and `LintKnownState` (per worktree), `LintChange` and `LintTransition`, `LintViewEntry`. Not in `CheckId` or `CodeCheckId`, and not in `types/index.ts`: import it from `types/lint.js`. |
| `src/core/lint/eslint.ts` | `eslintFindings(messages, text)`: ESLint 9 and 10's `LintMessage` fields as findings, with structural types, so the core imports no ESLint. A message with no line takes line and column 0. |
| `src/core/lint/fingerprint.ts` | `lineHash(line)`, `lintFingerprint(findings)`: sha1/16 of the sorted JSON `[rule, message]` pairs, duplicates kept, `null` for none. |
| `src/core/lint/transition.ts` | `lintTransition(before, after, cause)` and `matchFindings(before, after)`. |
| `src/core/lint/store/` | `openLintStore(commonDir, policy, { create, busyTimeoutMs })` and the repos: `results`, `states`, `transitions`, `views`, `meta`. |
| `src/core/daemon/policy-lint.ts` | `LINT_SHAPE`, spread in `daemon/policy.ts`. |

## Decisions the spec did not settle (approved 2026-10-26)

1. A transition compares the new result with the last **judged** one (`LintKnownState.judged`), which stays through `pending`, `unknown` and `stale`. So `fail -> pending -> fail` is no first-seen fail.
2. D2's last row: `lintTransition(..., "config")` returns `null` for every file. The pass (wave 1) passes `"config"` for a config, plugin or ESLint change and still writes the new states. The summary line is wave 2's.
3. Added and removed are matched in two stages: rule, message and line hash, then the rest on rule and message alone. The coordinator amends D2 at integration.
4. `lint.include` defaults to `["**"]`, which narrows nothing.
5. `results` are keyed by `(check, key)`, as the main store's results, not by the key alone.
6. The opener repeats about 50 lines of `code/store/open.ts`; nothing is imported from `src/core/code/`. A `/quality` candidate: one opener for both side stores (`isCorruption` already comes from `store/open.ts`).
7. In the replay, `b.js` at s5 is `pass-to-fail`: it was linted at s0 with no findings.

## What the next rows must know

- **Before findings come from `results`.** A state holds only the judged key and fingerprint. The pass reads the findings for `lintTransition`'s `before` from `results` at `judged.key`. So prune (not in this row) must keep every result a state's `judged_key` names, as the code store keeps the counts its `files` name. `results.used_at` is the last lookup, for retention.
- **`pending` and `unknown` are never results.** A timeout or a config that does not load is a state with `reason`; `outcome` moves, `judged` stays.
- **`stale` keeps the outcome.** D5's whole-program files set `stale: true` and keep `outcome` and `judged` until re-linted.
- **No staging yet.** The code store stages parts under a second worktree id (015 D4). The lint tables carry `worktree_id`, so the same scheme fits with no schema change if the pass needs it.
- **Schema v1 is complete for D6.** Any new column needs `user_version` 2 (015 D4's rule). An index that only adds a read path can come at open, as `CODE_INDEXES` does.
- **Key validity.** The policy loader is on the vitest component's bundle path. `test/keys/key-format.test.ts` passed in this worktree after the change (run 784b6a42, 38.6 s); no validity case was added.
- **Tests outside `test/lint/`** that list the whole policy got one line each, by agreement: `test/daemon/policy.test.ts`, `test/types.test.ts`.
