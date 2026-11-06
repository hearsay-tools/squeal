# Run triggers: when each kind of check runs

## Problem

Squeal decides alone when a check runs. Every covered test file runs after each edit that re-keys it, except the files a project marks slow (004 D1). Those run after the fast tests or when the agent pauses, by one repository-wide key, `slow.trigger` (004 D2). Lint runs on each edited file at once (017 D7). A project cannot say "unit tests after each edit, lint at commit, e2e tests at Stop". It can come close only by marking a whole runner slow. That gives cheap tests the slow tier's load guard and its one shared slot, makes the primer's "after each edit" false, and still holds one moment for every slow file (`research/runner-trigger.md` 1, 3).

Stop does not require what a project asks it to require. `stop.requireSlowSuite` gives one attempt: Stop waits up to 120 s by default and 600 s at most, then holds the agent once. After any Squeal message at Stop, the slow requirement is off for the rest of the turn. A slow file that is not queued is never started (`research/stop-wait.md` 1, cases C1 to C4). cezarion's whole slow tier takes 17 to 32 minutes (`stop-wait.md` 3).

Squeal sees a commit only as a `HEAD` move, up to 30 s later, and says nothing about it (`research/commit-checkpoint.md` 1).

## Goals

1. A project names check groups and gives each one a run moment: after each edit, after the fast checks, when the agent pauses, at Stop (Stop waits), or at commit. One example: unit tests after each edit, lint at commit, e2e tests at Stop. A group is a set of test files or lint checks, not a runner or a tool.
2. A repository with no new keys behaves as it does today. `slow.include`, `slow.trigger` and `stop.requireSlowSuite` keep their meaning.
3. "Slow" is not special (the human, 2026-11-03). Every group is alike: it has its own lane, its moment, an optional order within that moment ("after the unit tests"), and optional limits. Today's slow tier is one such group with the limits it has today. A long group never holds back another group's results.
4. Stop waits for every check of a group at Stop. It starts the checks that are not queued, and it can wait longer than 10 minutes. The project sets how many times Stop may hold the agent in one turn, default 1. A Squeal message at Stop no longer turns the requirement off for the rest of the turn.
5. Squeal reports each commit it sees, for example "Commit abc1234: 0 known failures; lint 2 findings; 1 test file not determined (unstaged changes)". The report never blocks the commit. Groups at commit run when Squeal sees the commit.
6. The agent is told the moment of each group in the primer and in status. A check that waits for its moment never reads as current (vision principle 2).

## Non-goals

- A blocking commit hook, or any hook Squeal installs in `.git/hooks`. A gate stays one line in the project's own hook: `squeal run --all --wait <ms>` (`commit-checkpoint.md` 4).
- A run moment per runner or per tool as the only unit. A test group names its runner and may narrow to one project or to globs; a lint group may name tools or take all.
- Stop waits in Pi and OpenCode. Their Stop handlers have a 2 s deadline; they keep one immediate hold (`stop-wait.md` C7).
- Codex SubagentStop never checking slow files. This is a defect against 004 D7, fixed by its own row (019-05), not by this spec.
- Remote test execution (`research/remote-runner.md`: not now).
- A change to keys. A check's moment decides when it runs, not what its result means. No `KEY_FORMAT_VERSION` raise.

## Design

### D1. Check groups and moments

A new optional key, `checks`, lists groups. Each group has a name, the checks it selects, and `at`, its moment. A test group names its runner (the human, 2026-11-03: "B: group names its runner"):

```json
"checks": [
  { "name": "e2e",  "runner": "vitest", "project": "e2e",     "at": "stop", "after": ["unit"],
    "limits": { "maxParallel": 1 } },
  { "name": "unit", "runner": "vitest", "tests": ["test/**"], "at": "edit" },
  { "name": "api",  "runner": "pytest", "project": "api",     "at": "pause" },
  { "name": "lint", "lint": true,                             "at": "commit" }
]
```

- **Test groups.** `runner` is required: `vitest`, `nodeTest` or `pytest`. `project` (optional) picks one Vitest project, or one `nodeTest` or `pytest` entry by its `name`. `tests` (optional) is a list of globs that narrows the selection to those files inside that runner (and project). With neither, the group is every file of that runner.
- **Lint groups.** `lint` is `true` for every lint check, or a list of tool names from `lint.tools`. A group has either `runner` or `lint`, never both. A lint group's moment works as a test group's (amended 2026-11-05, row 019-45; 0.1.402 honoured `commit` only): at `edit` the edited file is linted at once (017 D5); at `pause` an edited file waits and is linted when the agent pauses; at `stop` the same, and Stop starts and waits for that lint and tells its findings by 017 D8 (one hold, more only under `lint.blocking`, within `stop.maxHolds`); at `commit` as D5. A lint group key the build does not honour is a problem, never accepted and ignored.
- **A group selects; it never adds.** Which files a runner runs stays configured as today: Vitest and its projects from the project's own Vitest config, minus `vitest.exclude` and `vitest.excludeProjects`; `nodeTest[]` and `pytest[]` entries by their `include` and `exclude`; lint by `lint.tools`. A group picks among the checks these define, and each check keeps its runner. To put files no runner covers into a group, the project first gives them to a runner (for example removes a `vitest.exclude` line, or adds a Vitest project).
- **Ownership.** The first group that matches a check owns it; a narrow group goes above a wide one (`e2e` above `unit` in the example). A check that no group matches belongs to the default groups (D2).
- **`after`** (optional): names of groups this group follows at the same moment. At that moment the group starts once each named group has nothing pending or running at the current revision. In the example, Stop runs the unit tests not yet current first, then e2e. A name of a group at a later moment, an unknown name or a cycle is a problem. List order never sets run order; only `after` does.
- **`quietMs`** (optional): at `edit`, the group starts only once the latest revision is this old. Today's `slow.quietMs`.
- **`limits`** (optional, D3): `maxParallel`, `maxWorkers`, `priority`, `deferUnderLoad`. A group without `limits` runs as every other group does.
- **Moments**, from soonest to latest: `edit` (after each edit that re-keys it), `pause` (when the agent pauses; today's `slow.trigger: "idle"`), `stop` (`pause`, and Stop waits for it, D4), `commit` (when Squeal sees a new commit, D5), `manual` (never on its own: only on `squeal run <group>` or, for a test group, `run --all`, which lints no lint group at any moment (017); a manual lint group lints only on `squeal run <group>`; a named `status --wait` treats it as every group not at `edit`, holds not for its files and names `squeal run <group>`; amended 2026-11-05, row 019-47, the human: a group the agent runs when it wants, such as slow tests). A `manual` group is never required by Stop at either entry (D4), runs no commit report checks (D5), and no group at another moment may name it in `after`. Today's "after the fast tests" (`slow.trigger: "continuous"`) is `edit` with `after` and `quietMs`.
- Explicit requests ignore moments, as they do today: `squeal run`, `run --slow` for slow files, `run --all`, `status --wait` with paths.
- **Problems** (001 D11 loader rules; the group is left out and the problem names it): an unknown `runner` or moment; a `project` that the runner does not have; a glob that does not compile; both `runner` and `lint`, or neither; a group that selects none of its runner's checks; a group that selects only checks a group above it already owns. The last two are checked when the daemon has listed the runner's files, and reported as a daemon note, since the loader alone cannot list files.

The key name `checks` is a draft for review (open question 1).

### D2. Defaults, and today's keys

With no `checks` key, Squeal uses two default groups, which reproduce today's behaviour:

- `tests`: every covered test file that is not marked slow, at `edit`, with no limits.
- `slow`: every file marked slow (`slow.include`, `nodeTest[].slow`, `pytest[].slow`), at `edit` with `quietMs` from `slow.quietMs` under `slow.trigger: "continuous"`, or at `pause` under `"idle"`; with `stop.requireSlowSuite: true`, Stop also waits for it (under `"idle"` that makes it `stop`; under `"continuous"` it keeps running after edits, and Stop waits for what is not yet current, as today); `after: ["tests"]`; and the limits that `slow.maxParallel`, `slow.maxWorkers`, `slow.maxLoadPerCpu` and `slow.maxDeferMs` give it today, with `priority: "low"` (004 D2, D3, D10).
- Lint keeps `edit` for the edited file, and its stale whole-program re-lint keeps following `slow.trigger` (017 D5).

The resolver keeps "Stop waits for this group" as its own field, true for every group at `stop` and for the default `slow` group under `stop.requireSlowSuite`; it is not a user key (amended 2026-11-03, row 019-07: a literal reading moved a continuous slow tier to Stop, against Goal 2).

With a `checks` key, these defaults hold only for the checks no group owns. A group may own a file marked slow; the group's own settings then apply, and the loader notes that the file's `slow` marking is not used. The old keys stay valid and are documented as the settings of the default `slow` group.

### D3. Lanes and limits

Every group runs in its own lane. A lane queues and runs only its group's checks; a running tier in one lane never holds back another lane, so a 20-minute e2e pass does not delay the unit results of the next edit. This is what the slow lane does today (004 D2, row 004-18; `004-slow-suites/research/slow-tier-role.md` 4 measured the fast lane's median unchanged beside it), made general. All lanes take their workers from the one per-user run pool (011 C10), so the machine's total stays bounded as today.

Limits are optional per group and the same for any group:

- `maxParallel`: the most of this group's files running at once. For suites that use fixed ports, a shared database or much memory. Today's `slow.maxParallel`. The cap counts per repository (all its worktrees) by default; the host config (`~/.config/squeal/config.json`, never committed) sets `capacity.groupSlotScope` to `"user"` to count it across every repository of the user, as today's slow slot did (the human, 2026-11-03: "C with default being B and it's configured in the host config"). The default `slow` group follows the same setting, so with no host key two repositories' slow files may now run at once.
- `maxWorkers`: workers inside one run of this group. Today's `slow.maxWorkers`.
- `priority`: `"normal"` (default) or `"low"`. Every test process runs at `nice` 10 either way (011 C10). `"low"` is today's slow behaviour: `ionice -c 3`, the pool's lower waiter order, one file at a time while the worktree has `normal` work pending or the load is above the bound, and a running tier that runs to its end on a new edit. `"normal"` is today's fast behaviour, where a new edit may cancel a running Vitest tier. The default `slow` group is `low` (amended 2026-11-03, `research/lanes-survey.md` open questions 1 to 3).
- `deferUnderLoad`: `{ "maxLoadPerCpu": 1.0, "maxDeferMs": 600000 }` holds a run that a moment started while the load average per CPU is above the bound, for at most `maxDeferMs`. Today's load guard (004 D3). An explicit request (`squeal run <group>`, `run --all`, Stop's own request, D4) never defers.

A check that waits for its group's moment is pending for that moment: not stale and not current. Its last result, if any, stays history ("Earlier failures ... pending rerun", 004 D8).

### D4. Stop

For one consumer, the checks Stop requires are those whose moment is `stop`. The waiting entry (004 D9, `stop-slow`) changes as follows:

1. **Start them.** Before it waits, the waiting entry asks the daemon to run every required check that is not current, as `squeal run --slow` does for slow files today. That request queues files that are not run and not queued (a `lookup-only` miss, an `unknown` file), in `after` order, skips `deferUnderLoad` and the backlog, and keeps `maxParallel` (`stop-wait.md` 4, option d). Price: under load, Stop runs what a pause would have deferred; that is opt-in through `at: "stop"`.
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
5. The commit line is shown only in a repository whose policy has a `checks` key; the report is stored for every commit (amended 2026-11-03, row 019-16: Goal 2, a repository with no new keys behaves as today).

### D6. What the agent and the human are told

- **Primer.** One sentence per moment that has checks, naming the groups: "Squeal runs unit tests after each edit; e2e tests at Stop, and Stop waits for them; lint when you commit." The sentence "runs ... after each edit" no longer names a group that waits for another moment.
- **Status.** A line per group that is not all current, by the group's name; the default `slow` group keeps today's `Slow tier:` wording (004 D8). For example: "e2e: 12 test files wait for Stop; `squeal run e2e` runs them now". A `manual` group's line says its files wait for `squeal run <group>` (row 019-47). Slow files outside any group keep the `Slow tier:` line (004 D8). A group's files count in "not current" and never in "current".
- **Command.** `squeal run <group>` runs one group now, whatever its moment, as `run --slow` runs the slow tier (the human, 2026-11-03). `--wait` waits for its results. When the deadline passes before the daemon took the request, the no-verdict line (exit 3) names what held it as recorded, each with how long: the daemon's main thread (a heartbeat past its grace, a request it has not read, the lint keying it runs), then the daemon's startup or the scheduler lock's operation; otherwise that it is unknown, or that the daemon does not say. It ends with the next action: wait again with `squeal run <group> --wait`, or, for a lint group, run the linter (amended 2026-11-06, row 011-302, gh-154).
- **No test group at `edit`** (amended 2026-11-06, row 019-49, the human: "Approve as drafted"). When no test group runs at `edit`, nothing runs between edits, and silence is not a pass. The default `tests` group counts only when it owns a listed file (`groupsCoverage`). The primer's first sentence then says so in place of "passing results stay silent, so keep working", and keeps that a SQUEAL message means a check changed. The path-wait example becomes the narrow run (next item): before the agent relies on a result for files it changed, `squeal run <group> <path>... --wait 60000`. The skill and the status and delivery texts that say passing results stay silent say the same under such a policy. The primer stays within `PRIMER_CAP_CHARS` and its folding order. For example, for groups `lint`, `unit` and `node` at `stop` and `browser` at `manual`: "Squeal runs this repository's Vitest tests in the background, but no test group runs after each edit, so silence between edits is not a pass; a SQUEAL message with your next tool call means a check changed; do not run Vitest to learn whether your edits broke something. Check groups: lint, unit and node at Stop, and Stop waits for them; browser waits for `squeal run browser`; `squeal run <group> --wait 60000` runs one now. Before you rely on a result for files you changed: `squeal run <group> <path>... --wait 60000`; before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`." A policy with a test group at `edit` reads as before.
- **Narrow run** (amended 2026-11-06, row 019-49, the human: "A: run <group> <path>", "Edit rule"). `squeal run <group> <path>... [--wait <ms>]` runs now only the test files of the group that the paths select, whatever the group's moment, `manual` included. A test file's path selects itself. Another path selects the edit work 011 C4 step 4 keeps for it, among the group's files: the source's namesakes, or with none its direct importers, then the `runner.tierSize` shortest of its other direct importers. A selected file that is current does not run again; its result counts. The request skips `deferUnderLoad` and keeps `maxParallel`, as `squeal run <group>` does. `--wait` waits for the selected files only and gives their verdict as a named wait does (exit codes as `run <group> --wait`). The answer also names: the group's other files the paths reach, which still wait for the group's moment or `squeal run <group>`; the test files of other groups the paths select, by group, with `squeal run <other> <path>...`; and each path that selects nothing. A named `status --wait <path>...` that leaves a group's files names this command with the wait's own paths (up to 3, else `<path>...`), and the whole-group command for the rest (amended 2026-11-06, row 019-52, the human: "Go"). A narrow run never makes the group current: Stop's request (D4) stays whole, and a `manual` group's other files still wait for `squeal run <group>`. A lint group with paths is a usage error that names `squeal run <group>`. Not chosen: a `status --wait <path>` that starts the files a moment holds. A wait never starts work today, and in a repository whose slow group is at `pause` it would start that group on each path wait.
- **Skill.** The skill's policy reference lists `checks` and `stop.maxHolds`.

### D7. Cost

- After edits: what a group moved to a later moment no longer runs between edits. In cezarion, a node:test runner at `pause` would save at most 8.6% of runner time and move about 254 distinct failures a week from the next tool call to the next pause (`runner-trigger.md` 5). Moving the unit tests would defeat vision principle 3.
- At Stop: a group at `stop` makes the turn's end as long as the group's run. In cezarion a full browser pass is 17.5 min median and 32 min p90.
- At commit: the report is a key lookup; the commit groups run once per commit for the files the commit changed.

## Testing

- Policy: the loader accepts each selector, moment, `after` and limit, reports each problem per group (including an `after` cycle), and maps today's slow keys to the default `slow` group of D2 (a table test of configurations and resolved moments).
- Scheduler: in a fixture with Vitest and node:test, each moment queues the group at its moment and not before; a group without limits takes no load guard and no shared slot; a group with `limits` honours each; `after` holds a group until its predecessors settle at the revision; a long group's running tier does not delay another lane; explicit requests ignore moments.
- Stop: the waiting entry queues a not-run required check; it waits past 600 s with a short fake clock; `stop.maxHolds` 1 and 2 against a Stop after a fast-failure message (C2) and after more edits (C3); Codex and Claude Code fixtures both.
- Commit: a plain commit, a partial commit, an amend, a rebase and a commit with `core.hooksPath` set each give one report with the right counts; a commit group runs once per commit; nothing is denied.
- Texts: primer, status and skill wording per moment, Claude Code and Codex.
- Proof: an end-to-end run of a fixture with three groups (unit at `edit`, lint at `commit`, e2e at `stop`) through the shipped plugin, and a dogfood report in `lessons.md`.

## Open questions

1. The key name `checks` (D1). Selector shape decided (the human, 2026-11-03: the group names its runner). Owner: the human, at spec review.
2. Rename `stop.slowWaitMs` now that it covers groups that are not slow, with the old name kept as an alias? Owner: coordinator, at wave 0.
7. A lane per group: is a per-group Vitest instance acceptable in memory? Today the slow lane keeps a second Vitest instance, closed 60 s after its last run (004 D10, `runner-trigger.md` 1); with five Vitest groups that is up to five. Owner: wave 0 measures it; the fallback is one instance shared by the Vitest lanes, serialized.
8. ~~The scope of a group's `maxParallel` slot~~ Decided 2026-11-03, the human: per repository by default, `capacity.groupSlotScope: "user"` in the host config for every repository (D3).
3. ~~`squeal run <group>`~~ Decided 2026-11-03, the human: yes (D6).
4. With partial staging, is "not determined for this commit" enough, or should Squeal run those checks on the committed tree in a scratch checkout? Owner: the human; the draft says enough.
5. ~~Which commits get a report~~ Decided 2026-11-03, the human: every commit the worktree sees (D5), the human's, pulls and rebases included.
6. Does a Claude Code Stop fire after an interrupt (Esc)? Not determined (`stop-wait.md`). Owner: a probe in the Stop row.

## References

- Research: `research/runner-trigger.md`, `research/commit-checkpoint.md`, `research/stop-wait.md`, `research/remote-runner.md`.
- Specs: 004 D1 to D3, D7 to D9; 011 (policy loader, status); 017 D5, D7; 015-19 (a moved `HEAD` is not an edit).
- Vision: principles 2 (no stale result as current), 3 (feedback beside the work), 8 (explicit policy for anything outside the worktree), and "Policy-driven checkpoints".
