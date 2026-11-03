# Run triggers: when each kind of check runs

## Problem

Squeal decides alone when a check runs. Every covered test file runs after each edit that re-keys it, except the files a project marks slow (004 D1). Those run after the fast tests or when the agent pauses, by one repository-wide key, `slow.trigger` (004 D2). Lint runs on each edited file at once (017 D7). A project cannot say "unit tests after each edit, lint at commit, e2e tests at Stop". It can come close only by marking a whole runner slow. That gives cheap tests the slow tier's load guard and its one shared slot, makes the primer's "after each edit" false, and still holds one moment for every slow file (`research/runner-trigger.md` 1, 3).

Stop does not require what a project asks it to require. `stop.requireSlowSuite` gives one attempt: Stop waits up to 120 s by default and 600 s at most, then holds the agent once. After any Squeal message at Stop, the slow requirement is off for the rest of the turn. A slow file that is not queued is never started (`research/stop-wait.md` 1, cases C1 to C4). cezarion's whole slow tier takes 17 to 32 minutes (`stop-wait.md` 3).

Squeal sees a commit only as a `HEAD` move, up to 30 s later, and says nothing about it (`research/commit-checkpoint.md` 1).

## Goals

1. A project names check groups and gives each one a run moment: after each edit, after the fast checks, when the agent pauses, at Stop (Stop waits), or at commit. One example: unit tests after each edit, lint at commit, e2e tests at Stop. A group is a set of test files or lint checks, not a runner or a tool.
2. A repository with no new keys behaves as it does today. `slow.include`, `slow.trigger` and `stop.requireSlowSuite` keep their meaning.
3. When a check runs and what it costs the machine are separate. The slow tier's load guard, shared slot and low priority stay with files marked slow. A cheap group moved to Stop does not take them.
4. Stop waits for every check of a group at Stop. It starts the checks that are not queued, and it can wait longer than 10 minutes. The project sets how many times Stop may hold the agent in one turn, default 1. A Squeal message at Stop no longer turns the requirement off for the rest of the turn.
5. Squeal reports each commit it sees, for example "Commit abc1234: 0 known failures; lint 2 findings; 1 test file not determined (unstaged changes)". The report never blocks the commit. Groups at commit run when Squeal sees the commit.
6. The agent is told the moment of each group in the primer and in status. A check that waits for its moment never reads as current (vision principle 2).

## Non-goals

- A blocking commit hook, or any hook Squeal installs in `.git/hooks`. A gate stays one line in the project's own hook: `squeal run --all --wait <ms>` (`commit-checkpoint.md` 4).
- A run moment per runner or per tool as the only unit. A group may name one runner project or one lint tool, but it does not have to.
- Stop waits in Pi and OpenCode. Their Stop handlers have a 2 s deadline; they keep one immediate hold (`stop-wait.md` C7).
- Codex SubagentStop never checking slow files. This is a defect against 004 D7, fixed by its own row (019-05), not by this spec.
- Remote test execution (`research/remote-runner.md`: not now).
- A change to keys. A check's moment decides when it runs, not what its result means. No `KEY_FORMAT_VERSION` raise.

## Design

### D1. Check groups and moments

A new optional key, `checks`, lists groups. Each group has a name, what it matches, and `at`, its moment:

```json
"checks": [
  { "name": "e2e", "tests": ["packages/web/e2e/**"], "at": "stop" },
  { "name": "api", "tests": { "pytest": "api" }, "at": "pause" },
  { "name": "lint", "lint": true, "at": "commit" }
]
```

- `tests` is a list of test-file globs, or one named runner project: `{ "vitest": "<project>" }`, `{ "nodeTest": "<name>" }`, `{ "pytest": "<name>" }`.
- `lint` is `true` for every lint check, or a list of tool names from `lint.tools`.
- A group does not choose a runner. Runners stay configured as today: Vitest and its projects from the project's own Vitest config (minus `vitest.exclude` and `vitest.excludeProjects`), `nodeTest[]` and `pytest[]` entries by their `include` and `exclude`, lint by `lint.tools`. A group selects among the checks these already define, and each check keeps its runner. A glob that matches files of two runners selects both runners' files; a glob that matches no check selects nothing, which the loader reports.
- The first group that matches a check owns it. A check that no group matches has the default moment (D2).
- The moments, from soonest to latest: `edit` (after each edit that re-keys it), `after-fast` (when the fast checks of the worktree are settled and the revision is `slow.quietMs` old; today's `slow.trigger: "continuous"`), `pause` (when the agent pauses; today's `"idle"`), `stop` (`pause`, and Stop waits for it, D4), `commit` (when Squeal sees a new commit, D5).
- Explicit requests ignore moments, as they do today: `squeal run`, `run --slow` for slow files, `run --all`, `status --wait` with paths.
- The loader follows 001 D11. An unknown moment, a glob that does not compile, or a project name that does not exist is a problem for that group, and the group is left out.

The key name `checks` and the selector shapes are drafts for review (open question 1).

### D2. Defaults, and today's keys

With no `checks` key:

- A test file that is not slow has the moment `edit`.
- A slow test file (`slow.include`, `nodeTest[].slow`, `pytest[].slow`) has `after-fast` under `slow.trigger: "continuous"` and `pause` under `"idle"`. With `stop.requireSlowSuite: true` it has `stop`.
- A lint check has `edit` for the edited file. Its stale whole-program re-lint keeps following `slow.trigger` (017 D5).

So today's configurations keep their behaviour. `checks` overrides these defaults for the checks it matches. `slow.trigger` and `stop.requireSlowSuite` stay and are documented as the defaults for slow files. A group that sets `at` on slow files wins over them.

### D3. Moment and class are separate

"Slow" is a class: it decides how a check runs. The slow lane, the load guard (004 D3), the per-user slot (`slow.maxParallel`), `nice` and `ionice`, and `slow.maxWorkers` apply to slow files at any moment. The moment decides only when a check is queued.

- A group that is not slow runs in the fast lane at its moment, with the fast lane's capacity, without the load guard.
- A slow group runs in the slow lane at its moment, with today's guard and slot.
- A check at `pause`, `stop` or `commit` that the moment has not yet reached is pending for its moment. It is not stale and not current. Its last result, if any, stays history (011 status rules: "Earlier failures ... pending rerun").

### D4. Stop

For one consumer, the checks Stop requires are those whose moment is `stop`. The waiting entry (004 D9, `stop-slow`) changes as follows:

1. **Start them.** Before it waits, the waiting entry asks the daemon to run every required check that is not current, as `squeal run --slow` does for slow files today. That request queues files that are not run and not queued (a `lookup-only` miss, an `unknown` file), skips the load guard and the fast backlog, and keeps the slot (`stop-wait.md` 4, option d). Price: under load, Stop runs what a pause would have deferred; that is opt-in through `at: "stop"`.
2. **Wait longer.** The cap on the wait rises from 600000 ms to 3540000 ms, and the `stop-slow` hook `timeout` rises from 630 to 3600 s in the Claude Code and Codex plugins. Claude Code ran a Stop hook for 1900 s and acted on its block (`stop-wait.md` 2, probe b). Codex has no maximum; a new timeout makes users trust the hook again, and until they do Squeal falls back to the 2 s entry's immediate hold (004 D9, C7). The key that sets the wait, `stop.slowWaitMs`, keeps its 120000 ms default and covers every required check. Its name is open question 2.
3. **Holds per turn.** A new key, `stop.maxHolds` (default 1, at least 1), is the number of times Stop may hold the agent in one turn for required checks: a failure among them, or checks still not current at the bound. Squeal counts holds per consumer and turn in the store; a turn starts at a user prompt. It does not use `stop_hook_active` to decide. So a Stop after any other Squeal message (a fast failure, `blockOnKnownFailures`) still waits for the required checks while holds remain (closes C2 and C3). Claude Code ends a turn after 8 consecutive continuations with no tool call (its own cap); Codex has none, so `stop.maxHolds` is Squeal's loop guard there.
4. **Unchanged:** the 2 s entry, `stop.requireFullSuite`, `stop.blockOnKnownFailures`, the no-edit exemption (004 D9, task 004-67), the exit drain (004-29), and SubagentStop in Claude Code (one hold, no wait).

What the agent sees does not change in form: silence when all required checks pass; one block naming a failure with its delta; at the bound, one block naming the checks still not current and `squeal run --slow --wait` (or the group's run command, D6).

### D5. Commit report

Squeal learns of a commit from the daemon's `HEAD` move (`src/core/scheduler/head-move.ts`) and from a `HEAD` read at the agent's next tool boundary (Claude Code `PostToolBatch`, Codex `PostToolUse`), which removes the 30 s delay. It installs no git hook. It sees every commit in the worktree, including the human's, past `--no-verify` and `core.hooksPath`. A rebase is one move and one report for the new `HEAD` (`commit-checkpoint.md` 1).

On a move to a commit Squeal has not reported:

1. **Run the commit groups.** For each check of a group at `commit` whose file the commit changed (`git diff --name-only <old HEAD> <new HEAD>`, or every file of a group's closure for tests), queue it now, in its class's lane.
2. **Compute the report from keys.** For each test file and lint check, compute the key from the committed blobs. A key with a result gives that result. Where the working-tree blob differs from the committed blob (partial staging), the check is "not determined for this commit"; Squeal runs nothing on the committed tree (open question 4).
3. **Report.** One line, stored per commit SHA and delivered with the agent's next tool call or prompt, and shown in `squeal status` for the newest commit: `Commit abc1234: 0 known failures; lint 2 findings; 1 test file not determined (unstaged changes); 3 checks still running`. When the commit groups finish, a change delivery updates it once.
4. The report never blocks, denies or holds anything.

### D6. What the agent and the human are told

- **Primer.** One sentence per moment that has checks, naming the groups: "Squeal runs unit tests after each edit; e2e tests at Stop, and Stop waits for them; lint when you commit." The sentence "runs ... after each edit" no longer names a group that waits for another moment.
- **Status.** A line per group that is not all current, by the group's name, replacing the `Slow tier:` line for a group that is not slow: "e2e: 12 test files wait for Stop; `squeal run e2e` runs them now". Slow files outside any group keep the `Slow tier:` line (004 D8). A group's files count in "not current" and never in "current".
- **Command.** `squeal run <group>` runs one group now, as `run --slow` runs the slow tier. Open question 3.
- **Skill.** The skill's policy reference lists `checks` and `stop.maxHolds`.

### D7. Cost

- After edits: what a group moved to a later moment no longer runs between edits. In cezarion, a node:test runner at `pause` would save at most 8.6% of runner time and move about 254 distinct failures a week from the next tool call to the next pause (`runner-trigger.md` 5). Moving the unit tests would defeat vision principle 3.
- At Stop: a group at `stop` makes the turn's end as long as the group's run. In cezarion a full browser pass is 17.5 min median and 32 min p90.
- At commit: the report is a key lookup; the commit groups run once per commit for the files the commit changed.

## Testing

- Policy: the loader accepts each selector and moment, reports each problem per group, and maps today's slow keys to the D2 defaults (a table test of configurations and resolved moments).
- Scheduler: in a fixture with Vitest and node:test, each moment queues the group at its moment and not before; a cheap group at `pause` takes no load guard and no slow slot; explicit requests ignore moments.
- Stop: the waiting entry queues a not-run required check; it waits past 600 s with a short fake clock; `stop.maxHolds` 1 and 2 against a Stop after a fast-failure message (C2) and after more edits (C3); Codex and Claude Code fixtures both.
- Commit: a plain commit, a partial commit, an amend, a rebase and a commit with `core.hooksPath` set each give one report with the right counts; a commit group runs once per commit; nothing is denied.
- Texts: primer, status and skill wording per moment, Claude Code and Codex.
- Proof: an end-to-end run of a fixture with three groups (unit at `edit`, lint at `commit`, e2e at `stop`) through the shipped plugin, and a dogfood report in `lessons.md`.

## Open questions

1. The key name `checks` and the selector shapes (D1). Owner: the human, at spec review.
2. Rename `stop.slowWaitMs` now that it covers groups that are not slow, with the old name kept as an alias? Owner: coordinator, at wave 0.
3. `squeal run <group>`: a new command form, or only `squeal run --slow` for slow groups? Owner: the human, at spec review.
4. With partial staging, is "not determined for this commit" enough, or should Squeal run those checks on the committed tree in a scratch checkout? Owner: the human; the draft says enough.
5. Does the commit report cover every commit the worktree sees (the human's, pulls and rebases), or only the agent's? The daemon cannot tell them apart without a hook. The draft covers every move to a new commit, and a pull or reset reports too. Owner: the human.
6. Does a Claude Code Stop fire after an interrupt (Esc)? Not determined (`stop-wait.md`). Owner: a probe in the Stop row.

## References

- Research: `research/runner-trigger.md`, `research/commit-checkpoint.md`, `research/stop-wait.md`, `research/remote-runner.md`.
- Specs: 004 D1 to D3, D7 to D9; 011 (policy loader, status); 017 D5, D7; 015-19 (a moved `HEAD` is not an edit).
- Vision: principles 2 (no stale result as current), 3 (feedback beside the work), 8 (explicit policy for anything outside the worktree), and "Policy-driven checkpoints".
