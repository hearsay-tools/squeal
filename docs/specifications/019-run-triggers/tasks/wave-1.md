# Spec 019 wave 1: foundations (after the human approved the spec, 2026-11-03)

Three rows in parallel on disjoint files. 019-07 and 019-09 are product rows and land as one candidate after one review. 019-08 is a read-only survey; its file decides how wave 2 cuts the scheduler. No row changes what a repository without `checks` sees, except 019-09's longer Stop bound, which applies only where `stop.slowWaitMs` is raised.

## 019-07 policy: check groups and `stop.maxHolds`

Use /worker. Shape: slice. Outcome: `squeal.config.json` accepts `checks` (spec D1) and `stop.maxHolds` (D4 step 3, default 1), and a pure resolver names the group of any check, with today's keys as the default groups (D2). Nothing reads it yet.

Read: `spec.md` D1, D2, D3 (the `limits` fields), D4 step 3; 001 D11 loader rules; `src/core/daemon/policy.ts`, `policy-node-test.ts`, `policy-slow.ts`, `src/core/types/policy.ts`.

Seam and first edit: a new `src/core/daemon/policy-checks.ts` with the `checks` leaf (each group's fields, per-group problems: unknown runner or moment, `runner` with `lint`, a glob that does not compile, an unknown or later-moment `after` name, an `after` cycle), wired into `SHAPE` in `policy.ts`; `checks` and `stop.maxHolds` in `Policy` and `DEFAULT_POLICY`. Then a new `src/core/policy-groups/` (or `src/core/daemon/check-groups.ts`) with `resolveGroups(policy)` giving the ordered groups including the default `tests` and `slow` groups, `groupOf(groups, check)` for a test check (runner, project, path) and a lint check (tool, path), and `coverageProblems(groups, checks)` for "selects nothing" and "only reaches checks a group above owns", which the daemon will call once it lists files.

Owns: those files and new tests under `test/policy/`. Leave `src/core/scheduler/`, `src/harness/`, `src/core/slow/` alone.

Done when: table tests cover every D1 selector, moment, `after`, `quietMs`, `limits` field and problem, and the D2 mapping of `slow.include`, `nodeTest[].slow`, `pytest[].slow`, `slow.trigger` and `stop.requireSlowSuite` to the default `slow` group; existing policy tests pass by `squeal status --wait 60000 <changed-path>...`; lint and typecheck pass.

## 019-08 survey: lanes per group

Use /researcher. Shape: survey. Outcome: `research/lanes-survey.md`, a map of where the slow lane and its limits live today and a proposed cut of wave 2 into rows with disjoint file ownership. Rules: `research/README.md`.

Read: `spec.md` D1 to D6 and open question 7; spec 004 D2, D3, D10; 011 C10 (the run pool); `src/core/scheduler/slow-tier.ts`, `slow-trigger.ts`, `slow.ts`, `slow-release.ts`, `tiers.ts`, `capacity.ts`, `slots.ts`, `scheduler.ts`; `src/core/lint/pass/idle.ts`; `src/core/scheduler/head-move.ts`; `src/cli/run-slow.ts`; the status and delivery code that writes the `Slow tier:` line.

Answer: (1) which code is slow-specific and how it would become a lane per group with `after`, `quietMs` and `limits`; (2) how lanes share the per-user pool and the cross-worktree slot; (3) open question 7: memory and start time of one more Vitest instance, measured on a fixture under `$TMPDIR` (skip timing when the load average is above the CPU count, and say so); (4) the seams for D4 (required checks of `stop` groups, holds per turn), D5 (commit report from the `HEAD` move and the tool boundary), D6 (`squeal run <group>`, status lines, primer); (5) the proposed wave 2 rows, each with a starting seam, the files it owns and a done-when.

Owns only `research/lanes-survey.md` and `research/probes/lanes-survey/`. Done when that file is committed and no daemon or directory of yours is left.

## 019-09 Stop starts the slow tier and may wait 59 minutes

Use /worker. Shape: slice. Outcome: under `stop.requireSlowSuite`, the waiting Stop entry asks the daemon to run the slow tier before it waits, as `squeal run --slow` does, and its wait may reach 3540000 ms (spec D4 steps 1 and 2; `research/stop-wait.md` 4, options d and a).

Read: `spec.md` D4; `research/stop-wait.md` cases C4 to C6 and finding 2; 004 D9; `src/harness/shared/stop-slow.ts`, `src/core/slow/stop-wait.ts`, `src/cli/run-slow.ts` and the daemon's `run-slow` request in `src/core/daemon/protocol.ts`.

Seam and first edit: in the waiting entry, after the handoff and before the poll, send the daemon the `run-slow` request (`queueSlowSuite`: queues keyed slow files not current, clears `unknownKey`, skips the load guard and the fast backlog). Then `STOP_SLOW_WAIT_CAP_MS` to 3540000, `STOP_SLOW_HOOK_TIMEOUT_S` to 3600, and the `stop-slow` `timeout` in `plugins/claude-code/hooks/hooks.json` and `plugins/codex/hooks/hooks.json`.

Owns: `src/harness/shared/stop-slow.ts`, `src/core/slow/stop-wait.ts`, the two `hooks.json` files, and the tests that pin them (`test/harness/plugin.test.ts`, `test/plugins/codex/hooks-json.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, the stop-slow tests under `test/harness/`). Leave the policy files to 019-07. Do not run `pnpm run build`.

Done when: a test shows a slow file that was not run and not queued (a `lookup-only` miss) is run and the waiting Stop goes silent once it passes (case C4); a test shows the load guard does not defer that run (C5); the cap and timeout tests pass at the new values; affected tests pass by `squeal status --wait 60000 <changed-path>...`; lint and typecheck pass. Name in your final message what a Codex user sees when the new timeout makes Codex ask to trust the hook again.
