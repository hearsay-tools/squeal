# 019-45 notes: a lint group at `pause` or `stop` is honoured, not ignored

Worker 5a8b7360, 2026-11-05, branch `cez/5a8b7360`. Wave 9 brief, spec 019 D1 as amended 2026-11-05, D4, D5 step 1; 017 D5, D8. Base: `956c7a451`.

## The cause, as found

- The lint pass looked at a lint group's moment only for `commit` (`commit-entry.ts` `commitHold`, `heldForCommit`). A group at `pause` or `stop` read as "no hold": every edit linted at once, as at `edit`.
- Stop required test files only (`required.ts`): `stopRequired` put a lint group at `stop` in `groups`, but `requiredNotCurrent` reads test files, so the lint group never had an open check. The waiting entry found "complete" at once and said nothing.
- The loader accepted `after`, `quietMs` and `limits` on a lint group (`policy-checks.ts` `LINT_RULES` took `COMMON`), and no code read them for lint.

## What changed

- **Loader** (`src/core/daemon/policy-checks.ts`). A lint group has only `name`, `lint` and `at`. `after`, `quietMs` or `limits` on one is a problem: `"checks[0].after" applies to test groups only; a lint group has "name", "lint" and "at"; group "l" is left out`.
- **`after` naming a lint group** (`src/core/daemon/policy-checks-settle.ts`, agreed with the parent, request 8c630c67). The scheduler's `groupHolds` finds no lane for a lint group, so a follower never waited: `"checks" group "e2e": "after" names "lint", a lint group; a group follows test groups only; it is left out`.
- **Skill reference** (`plugins/claude-code/skills/squeal/references/policy.md`, the source only; request 8c630c67): `after`, `quietMs` and `limits` apply to test groups; a lint group lints at its moment. The Codex and Pi copies come from the build at integration, so `test/harness/skill.test.ts` reads drift in this tree.
- **The hold, any moment but `edit`** (`src/core/lint/pass/moment.ts`, `commit-entry.ts`). `heldBy(policy, tool)` gives the owning group and its moment. `momentHold` replaces `commitHold`: at `commit` it is as before; at `pause` and `stop` it holds every waiting path (pending or stale) until a release names it at its blob. When `pauseIn()` reads 0 (no consumer in a turn), the pass releases every waiting path at its blob first, then lints them as an edit's (not quiet), so each result is news once. `releaseLintGroup` (`squeal run <group>`, and Stop's request) releases for any held moment.
- **The pause** (`src/core/lint/pass/idle.ts` `lintPauseIn`, `types.ts` `pauseIn`). `consumersIdle` on the main store, 0 or `SLOW_RECHECK_MS`, whatever `slow.trigger` says, as a test group at `pause` (`momentHolds`). While a path waits, the pass wakes at `now + pauseIn` (`run.ts` `wakeOf`). The daemon passes it beside `idleIn` (`src/core/daemon/daemon.ts`, 2 lines).
- **The hold record** (`lint-held:<scope>`) is now JSON `{ "group", "at" }`. `readHeld` reads a bare group name (0.1.402, 0.1.403) as `at: "commit"`.
- **Status** (`src/core/lint/surface/{snapshot,report,format}.ts`, `LintStatus.awaitingPause`, additive optional). `Lint: 0 files with findings, 1 waits for the agent to pause; squeal lint lists them.` The pending checks of a pause or stop hold are counted apart from `not linted yet`. `linting, N of M` leaves them out, as it leaves out a commit's.
- **Stop requires the lint group** (`src/core/state/required.ts`). `StopRequired.groups` now holds test groups only; `lintGroups` and `lintGroupOf(tool)` name the lint groups at `stop` whose tools lint runs (none while lint is off). `requiredLintOpen` reads their checks that wait to lint (pending or stale; `unknown` waits for no lint). `stopRequired` is `null` only with neither.
- **The waiting entry** (`src/harness/shared/stop-slow.ts`). It reads the open lint checks with the test files, asks their group to run (`requestGroups`, `run-group` by name), and is complete once none waits. A pending runner part delays completion only while a test group is required. Once complete, `requiredLintHold` (`stop-lint.ts`) gives the reasons to hold: FAIL lint news of the required tools not yet told (read only with `readLintNews`; the hold's delivery tells it), and under `lint.blocking` the required tools' files gone to fail since the session started. Each hold counts in `stop.maxHolds`. At the bound the hold names the lint checks still not linted.
- **The 2 s entry** (`src/harness/shared/stop-decide.ts`). `heldFor` returns tests and lint; a lint check not linted holds as a test file not current does, so Pi and a session whose waiting entry does not run still hold once and name `squeal run <group> --wait`.
- **Wording** (`src/harness/shared/stop-lint.ts`, `stopGroupWords` exported from `stop-text.ts`):
  - linted with findings: `Squeal policy checks puts the lint group at stop and the lint group ran at revision 2: 1 file has lint findings: src/a.js.`
  - 2 s entry: `... and 1 lint check is not linted at revision 2: src/a.js. \`squeal run lint --wait\` runs them and waits for their results.`
  - bound: `... and after 5 s 1 lint check is still not linted at revision 2: src/a.js. \`squeal run lint --wait\` waits for their results.`

## Decisions the spec did not settle (my choices)

1. **A pause releases paths as a commit does, but quietly.** The pause writes `lint-release:<scope>` for every waiting path at its blob. An edit's pending path is not in the quiet set, so its lint records a transition and D8 tells it; a first or config keying's path stays quiet, as at `edit`. A path linting when the agent resumes finishes; an edit to it moves its blob and it waits again.
2. **Only FAIL news holds Stop.** A required lint check that went to PASS is told at the next boundary; Stop stays silent when all required checks pass (D4's last paragraph).
3. **A `lint.blocking` hold names every lint group Stop waits for** in the last-hold line, since its evidence is per file, not per group.
4. **Status words `pause` and `stop` alike**: "waits for the agent to pause". Stop's own wording names the group at stop. A commit hold's status wording is unchanged (`N not linted yet`), to keep brief test 4.
5. **The lint pass polls the pause** every `SLOW_RECHECK_MS` (15 s) while a path waits, as the slow lane does. The 2 s Stop entry's `nudgeSlow` nudges the scheduler only, not the lint passes, so a pause lints up to 15 s after the turn ends. Stop itself does not wait for that: its request lints at once.

## Type changes (all additive)

- `LintPassOptions.pauseIn?: () => number`.
- `LintStatus.awaitingPause?: number`.
- `StopRequired.lintGroups`, `StopRequired.lintGroupOf` (new required fields of an internal interface built only by `stopRequired`); `StopRequired.groups` now holds test groups only.
- New: `RequiredLint`, `requiredLintOpen` (`required.ts`); `HeldBy`, `HeldMoment`, `heldBy`, `readHeld`, `markHeld`, `lintGroupOf` (`moment.ts`; `commit-entry.ts` re-exports `lintGroupOf`); `MomentHold`, `momentHold` replace `commitHold`; `lintPauseIn`, `LintPauseOptions`.

## Tests (each committed red before its fix)

- `test/policy/checks-problems.test.ts`: `after`, `quietMs`, `limits` on a lint group (brief test 3).
- `test/policy/checks-after.test.ts`: a test group whose `after` names a lint group.
- `test/lint/pass/moment-hold.test.ts`: at `pause` and at `stop`, an edit lints nothing in a turn, status says it waits for the agent to pause, the pass wakes by itself at the pause, lints, and the FAIL line is told once; at `edit` unchanged (brief test 1).
- `test/lint/pass/idle.test.ts`: `lintPauseIn` reads 0 with no consumer or a paused one, `SLOW_RECHECK_MS` in a turn.
- `test/lint/wiring/stop-group.test.ts`, Claude Code and Codex: Stop asks for the lint group, waits, holds once with the FAIL line, then is silent; `lint.blocking` with `stop.maxHolds: 2` holds a second time with the blocking reason, then is silent; without the waiting entry known, the 2 s entry holds at once naming the check and the run command (brief test 2). `test/lint/wiring/rig.ts` `hookedRepo` takes a policy; with one, the pass reads it and the real pause.
- Brief test 4: the commit and edit lint tests (`test/lint/pass/commit-entry.test.ts`, `commit-provenance.test.ts`, `test/scheduler/commit-lint.test.ts`, `test/commit/*`) and the Stop tests (`test/harness/stop-*.test.ts`) unchanged.

## For the next worker

- The committed bundles (`plugins/claude-code/dist`, the Codex runtime) and the skill copies are not rebuilt (no build in this row): `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts` and `test/harness/skill.test.ts` fail on drift until the build at integration.
- `squeal run <lint group> --wait` (`src/cli/run-lint-group.ts`) counts a path as `held` only for a commit group; for a pause or stop group a path edited after the request is counted as linting until the deadline. Not changed here.
- The commit report (`src/core/commit/lint.ts`) uses `heldForCommit` and is unchanged: a pause or stop group's pending check reads as still running there.

## Repair (review 0.1.406)

Worker 40883003, 2026-11-05, branch `cez/40883003`, base `261e71fbb`. Each finding: a failing test committed first, then its fix.

### B1: the program feed obeys the hold

- **Cause.** `parts.ts` `nextPart` took `ctx.feed` (changed program files, 017 D5) before the held queues, and `lint-part.ts` judged every feed file that waited to lint. A typed file edited in a turn linted at once, at `pause`, `stop` and `commit` alike.
- **Change.** While a group holds the tool's checks (`ctx.held` not `null`), the feed alone starts no part: it stays in `PassState.feed` and goes with the first part that lints a released path (edit, backlog or stale). In a call, a held feed path is fed only, never judged or stored (`waiting` in `lintFiles`); `unknownPart` leaves a held path waiting. The released call feeds every program file changed since, so the worker holds the keys' bytes. No feed path is dropped.
- **Tests.** `test/lint/pass/moment-hold.test.ts`, "a held lint group's program feed": at `pause` and `stop`, an edit to `src/a.js` and `src/types.d.ts` (both program files) makes no lint call in a turn, and the pause's call is `[src/a.js, src/types.d.ts]`; at `commit` the same until `releaseLintGroup`.

### B2: one decision and one budget for required lint failures

- **Cause.** The 2 s entry blocked for every `lint.blocking` failure through `lintStopReasons`, a block that counts no hold; the waiting entry then held again for the same failure from the full budget.
- **Change** (`stop-decide.ts`, `stop-lint.ts`).
  - `StopRules.lint` (new): the lint groups Stop requires, `holds` while this Stop may hold, `last` for the last-hold line.
  - `lintFailing`: once no required lint check waits to lint, the 2 s entry holds for the required tools' `lint.blocking` failures itself (`requiredLintBlocking`). This applies whether or not the waiting entry runs, because nothing is left to wait for. The hold counts in `stop.maxHolds` (`held`), with stop hook active too, as a required hold does. With a required lint check still open, the waiting entry (or the 2 s entry's open hold, when it decides) keeps the decision.
  - `lintStopReasons(context, command, required)` leaves out the tools of the required lint groups. `lint.blocking` for other tools is unchanged (one block, never with stop hook active).
  - `stopRules` split into `budget` and `othersBlock` (complexity 23 to 14).
- **Tests.** `test/lint/wiring/stop-group-holds.test.ts`, Claude Code and Codex: lint finished before Stop after `squeal run lint` and at a pause between turns, `stop.maxHolds` 1 and 2, waiting entry known; and after `squeal run lint` without the waiting entry (2 s entry alone). Each gives exactly `maxHolds` continuations, every one with the `lint.blocking` reason, then silence.
- **Changed expectation.** `test/lint/wiring/stop-group.test.ts`, "with lint.blocking, holds again": the second hold now comes from the 2 s entry, not the waiting entry. The agent still sees one block with the same reason.

### B3: Stop decides from every untold change

- **Cause.** `untoldLintFails` read `readLintNews(...).news.entries`, which keeps at most `LINT_LISTED_MAX` (5) entries across all tools. Another group's failures could fill the list.
- **Change.** `LintNewsRead.untold` (new, additive): the plan's entries before the cap. `untoldLintFails` reads it. The read stays read only, and the delivery after the hold still lists five, counts the rest and acknowledges all.
- **Tests.** `test/lint/wiring/stop-group-cap.test.ts`, Claude Code and Codex: ESLint at `pause`, oxlint at `stop`. With six ESLint failures before oxlint's, and with oxlint's only failure sixth, the waiting entry holds once naming `src/a5.js (oxlint)`, and the next Stop is silent. `test/lint/surface/states.test.ts`: a read keeps all seven changes in `untold`.

### Decisions the review did not settle (my choices)

1. **B1 at `commit` too.** The feed bypassed every held moment, so the fix applies to `commit` as well, with a test. The commit tests in `test/lint/pass/commit-*.test.ts` are unchanged.
2. **B2 takes the "consume the same budget" route, not the hand-off.** The 2 s entry's news (the FAIL line) is itself a continuation; in Codex it is a block. Handing the failure to the waiting entry would still cost a continuation for that news, uncounted. So the 2 s entry decides the precompleted case, in the same hold as its news.
3. **B2 needs no `lint.blocking` for untold findings in the 2 s entry.** Without `lint.blocking`, its news tells the FAIL line (as before), and the waiting entry then finds nothing untold.
4. **After a pause the next prompt tells the finding**, so in that case no Stop repeats the FAIL line. The test expects it 0 times there and once after `squeal run lint`.

### Type changes (all additive)

- `StopRules.lint` (internal, built only by `stopRules`).
- `LintNewsRead.untold`.
- `lintStopReasons` takes an optional third parameter, `required`.
- `hookedRepo` (test rig) takes an optional fourth parameter, `{ eslint, oxlint }`.

### For the next worker

- The bundles are not rebuilt (no build in this row). `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` and the other bundle tests read drift until the build at integration.
- `src/harness/shared/stop.ts` is unchanged. `decideTurn` still waits for the waiting entry's record on any hold, the lint hold included (up to `STOP_RECORD_WAIT_MS`, 500 ms, on the turn's first hold when the record is missing). Then it decides again with the same result.

## Repair 2 (review 0.1.406-r2)

Worker 2a0d3281, 2026-11-05, branch `cez/2a0d3281`, base `2022e97af`. Third and last round (the human, 2026-11-05). Failing tests committed first (`792d017c1`, corrected in `d016c0c5f`), then the change (`2a8320f5e`).

### B2-R1: the 2 s entry spent a hold on lint while a required test was open

- **Cause.** One rule had two owners. The 2 s entry (`stop-decide.ts`) held for a required `lint.blocking` failure once no required *lint* check waited (`lintFailing`). It did not look at required test files or the runner part: with the waiting entry known, `required` was `null` there, so `heldFor` read nothing. The waiting entry (`stop-slow.ts`) then found the turn's holds spent and never asked for the tests.
- **The single owner.** New `src/harness/shared/stop-required.ts`, `requiredStep(context, required, read, { untold, at, command })`. For one consumer and turn it returns, in this order:
  1. `open`: test files not current, the runner part pending while a test group is required, and lint checks not linted (`requiredOpen`).
  2. `failing`, only when nothing is open: with `untold` (the waiting entry), untold required test failures, untold lint findings and `lint.blocking` failures (`requiredLintHold`); with `untold: null` (the 2 s entry), `lint.blocking` failures only, since its news tells the untold ones in the same continuation.
  3. `null`: nothing to hold for, and always for a main agent with no revision since it registered (004-67).
  `stepReason` words a hold for either step, the 2 s entry's words or, with `waitedMs`, the waiting entry's at its bound. `openGroupsOf` names the groups a request runs.
- **The 2 s entry** (`stop-decide.ts`). `StopRules.holds` (replaces `lint` and `lastHold`): the required checks while this Stop may hold, whichever entry decides open checks, and `last`. `decide` calls `requiredStep`: an open step holds only when this entry decides (`required` not `null`, no waiting entry known); a failing step holds in both cases and counts. `holdsNow` is true only for an open step. `heldFor`, `lintFailing` and `heldReason`'s old body are gone. `lintStopReasons` still leaves out the required lint tools, now from `stopRequired(project)`, so a spent budget does not turn them back into a general block.
- **The waiting entry** (`stop-slow.ts`). Its poll reads `requiredOpen`, asks `openGroupsOf` (tests' and lint's groups at once, D4 step 1), and its `decide` calls `requiredStep` with the consumer's views. `complete`, `openOf`, `untold` and `holdReason` moved into the owner.
- **Tests.** `test/lint/wiring/stop-group-mixed.test.ts`, Claude Code and Codex, 24 cases: a lint group and a unit group at `stop`, `lint.blocking`, lint finished before Stop; the unit file queued, keyed and not queued (lookup-only), or the runner part pending; `stop.maxHolds` 1 and 2; waiting entry known and not. Known: the first Stop tells the FAIL line as news and holds nothing; the waiting entry asks for `unit` (queued and lookup-only) or waits for the runner part, then holds for the lint failure; `maxHolds` holds in all. Not known: the 2 s entry's first hold names the unit file or the runner part, not the lint failure; the lint failure takes the holds left. The B2 matrix (`stop-group-holds.test.ts`) and B3 (`stop-group-cap.test.ts`) are unchanged.

- **Changed expectation.** `test/harness/stop-slow-untold.test.ts`, "a slow failure told before the turn ended does not block": its second `startTurn` re-registers the session, which clears the waiting entry's record, so the 2 s entry decided there and now holds for the pending runner part (decision 3). The test marks the waiting entry again after that start, as `repo()` does, so the waiting entry decides as the test means.

### Decisions (agreed with the parent, request a95e61a9)

1. **New file** `src/harness/shared/stop-required.ts` for the owner. `stop-decide.ts` went from 344 to 278 lines, `stop-slow.ts` from 392 to 290.
2. **Tests and lint open in one step.** The waiting entry asks for every open required group at once (D4 step 1) and waits for all of them. The 2 s entry alone names open test files (or the runner part) and open lint checks in one hold, tests' line first. Failure holds come only when nothing required is open.
3. **The 2 s entry alone holds for a pending runner part** while a test group is required and no required file is open, which it did not before (`requiredUnlistedReason`): `Squeal policy checks puts the unit group at stop and the runner part of revision 2 is still pending: unit test files it adds are not listed yet. \`squeal run unit --wait\` runs them and waits for their results.` A runner part that never finishes costs at most `stop.maxHolds` holds.
4. **News before the hold.** With the waiting entry known and a required test open, the 2 s entry's news tells the FAIL lint line (017 D8) and holds nothing; the waiting entry then holds for `lint.blocking` after the tests. That news is a continuation outside `stop.maxHolds`, as D4 step 3 counts "any other Squeal message". The lint-only precompleted case keeps exactly `maxHolds` continuations (B2).

### Type changes

- New: `RequiredRead`, `RequiredOpen`, `RequiredStep`, `requiredOpen`, `isOpen`, `openGroupsOf`, `requiredStep`, `stepReason` (`stop-required.ts`); `requiredUnlistedReason` (`stop-text.ts`).
- `StopRules`: `holds` replaces `lint` and `lastHold` (internal; `stop.ts` reads only `required`, `blocking`, `handoff`). `holdsNow` takes an optional `now`.

### For the next worker

- Bundles are not rebuilt (no build in this row): `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` read drift until the build at integration.
