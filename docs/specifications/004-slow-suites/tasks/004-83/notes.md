# 004-83 an agent knows it can wait for slow files: worker notes

Worker 869c1188, parent 6a627ff7, 2026-10-19. Brief: `../wave-14.md` § 004-83. Branch `cez/869c1188`, base `e48a243f`.

## 1. Mechanism: `run --slow --wait` already joined a running slow file

`test/scheduler/slow-request-join.test.ts` (new): a real scheduler and Vitest adapter, one slow file under `continuous`, its run held at the gate mid-run; then `requestSlowSuite`. The request counts the running file (`queued: 1`), so `run-slow.ts` passes `holdSlow`; the wait's first read (`pendingSlow`) holds it; releasing the run discharges the hold (`heldSlowLeft` empty); the file ran once and its checks are current.

It was **green on unchanged code**, so there is no red-before-fix commit: `queueSlowSuite` (`src/core/scheduler/slow-tier.ts`) already counts a slow file with a phase (queued or running) and settles only those without one, and `SlowTier.request` aborts only a load-guard wait, never a run. To show the test discriminates, a mutation dropping running files from the count (`0 * pending.length`) turned it red (`expected +0 to be 1`); reverted. No product change for the mechanism.

The harness registers no `worktrees` row, so the test upserts one (the CLI's wait reads the policy from the worktree's root, as a daemon registers it).

## 2. Texts, before and after

`W` = `` `squeal run --slow --wait 60000` ``; "its result" when one file is not current, else "their results".

| Where | Before (0.1.221) | After (0.1.222) |
|---|---|---|
| Quiet `status --wait`, policy off (`src/cli/status-wait-lines.ts` `slowTierText`) | `; N slow files are not current[ and Squeal runs …]; this repository does not require them before you finish (`squeal run --slow` runs them)` | `; N slow files are not current[ and Squeal runs …]; this repository does not require them before you finish; W waits for their results` |
| Quiet `status --wait`, policy on | `…, which this wait does not hold for: W runs and waits for them` | unchanged |
| Named wait's pause text, policy off (`pauseText`, idle only) | `…; this repository does not require it before you finish` | `…; this repository does not require it before you finish; W waits for its result` |
| Named wait's pause text, policy on | `…; this repository requires it before you finish: W runs and waits for it` | unchanged |
| `Slow tier:` line ending, both policies (`src/core/state/slow-text.ts`) | `…; `squeal run --slow` runs them now.` | `…; W waits for their results.` (count: files not current) |
| Primer, policy off (`src/harness/shared/primer.ts`) | `…, else say how many are not; W runs them now.` | `…, else say how many are not, or wait for them with W.` |
| Primer, policy on | `…before you say the task is done, run W unless the latest …` | `…before you say the task is done, wait with W unless the latest …` |
| Primer, `slow.trigger: "idle"` | `Slow test files run when you pause between turns; …` | `Slow test files run between your turns; …` |
| `Affected checks` headline (`src/core/status/format-status.ts`, text in `slow-text.ts` `slowAffectedText`) | `N passed …, M running …, K queued …` | the same, then, with slow files pending: `; among them 4 slow test files, a, b, c and 1 more: W waits for their results` (one: `; among them 1 slow test file, a: W waits for its result`; a project's file as `project: path`) |

Codex primer: where the CLI is a long path the sentence keeps 004-78's "the CLI's `run --slow --wait 60000`" (`naming` other than `every`), and the wait sentence still names the CLI by path at every reach the 004-78 test pins (230 characters).

Skill references (`plugins/{claude-code,codex,pi}/skills/squeal/references/`): `commands.md` (status: the headline names slow files and the wait; quiet line: "waits for their results, joining a slow file already running"; `run --slow --wait`: "one already running counts: the wait joins its run instead of starting another"), `reports.md` (Slow tier: the ending names the wait).

## Decisions the spec did not settle

- **Policy on keeps "runs and waits for them"** in the quiet line and the pause text: the spec's 004-71 paragraph says policy on "stays", and the brief says it keeps "which this wait does not hold for". Changing it to "waits for their results" too would read more uniformly; one-line change in `status-wait-lines.ts` if wanted.
- **Primer wording is "wait with W" / "or wait for them with W"**, not "W waits for their results": the literal phrase cost 10 to 25 characters, which pushed the policy-on Claude Code primer past `PRIMER_CAP_CHARS` (it dropped the path wait) and cut the Codex fold's CLI reach below 004-78's 230 characters. To keep both, idle's "when you pause between turns" became "between your turns" (10 shorter). Reach now: continuous 230 to 235, idle 232 to 237 characters (`test/harness/primer-wait.test.ts` comment).
- **Headline names every pending slow file**, with checks (running or queued) or without (queued, counted in the same line's "test files without checks yet"), first three in path order then "and N more". Same text under both policies.
- **Grammar by count**: "its result" for one file not current, "their results" otherwise, in every text.
- Not changed, not in the brief: the named-wait per-file reason `slow, run … or on `squeal run --slow`` (`src/cli/named-file-lines.ts`), and Stop's block text.

## Type changes (additive)

- `SlowPendingCounts.files?: readonly TestFileRef[]` (`src/core/types/status.ts`): the first three pending slow files in path order (`SLOW_FILES_NAMED` in `src/core/state/header.ts`), absent when none. `status --json` carries it under `slowPending`.
- New exports from `src/core/state/index.ts`: `slowWaitText`, `slowAffectedText`.

## Files outside the brief's list

`src/core/state/header.ts` (the headline needs the paths) and `src/core/state/index.ts` (exports), `test/harness/stop-slow.test.ts` (its `slowPending` pin gained `files`), `test/harness/primer-wait.test.ts` (reach comment), `test/status/slow-tier-truth.test.ts`, `test/scheduler/slow-off-line.test.ts`, `test/cli/run-slow-wait.test.ts` (text pins).

## Evals parsers

No parser change was needed: `slowNotCurrentOf` splits the tier on `; ` and the ending starts with a backtick; the `slow` state regex finds none of its words in "waits for their results"; `countsOf` reads the first `N running` / `N queued` in `Affected checks`, which the slow clause follows. `test/evals/slow-wait-text.test.ts` (new) round-trips status, a quiet `status --wait`, a registration and a news header from the real formatters, both policies and triggers, plain and in hook JSON, and reads literal 0.1.215–0.1.221 lines with the old endings.

## For the next worker or the coordinator

- `plugins/*/dist` is not rebuilt (no `npm run build` in this row): the bundle-drift tests (`test/harness/plugin.test.ts` and the per-plugin "has the bundles exactly as …" checks) fail until the coordinator builds 0.1.222.
- `KEY_FORMAT_VERSION` 13 re-pinned in place (unreleased; no `squeal--v0.1.22*` tag); any further `src/` change re-pins it again.
