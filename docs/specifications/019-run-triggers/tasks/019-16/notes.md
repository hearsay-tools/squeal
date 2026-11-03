# 019-16 notes: texts per group and the commit line

Worker fdf7edb7, 2026-11-03. Spec D5 step 3, D6. Baseline cand/0.1.396.

## What changed

- **Golden first.** `test/status/group-texts-golden.test.ts` recorded, before any change, the status text, the header's full and news forms (slow files declared and not) and the primer under four slow policies (Claude Code and Codex). It still passes unchanged.
- **Header** (`src/core/state/header.ts`, new `groups.ts`). The policy is read once per header. With a `checks` key only (`groupTextsShown(policy)`, the one condition): `groupTiers` (each configured test group's lane state, `GroupTierState`), `lanePending` (pending work of every file a group lane owns, the default `slow` group's included) and `commitLine` (the newest stored report as text). Without the key none of the three is set.
- **Slow tier under groups.** `slowPolicyView(policy).isSlow` is "the default `slow` group owns it" when `checks` is present (a configured group may own a file marked slow, D2); without `checks`, today's `slowFiles`. The `Slow tier:` line is left out with `checks` once the files are listed and the slow group owns none.
- **`readLane`** (`state/slow.ts`) is the old body of `readSlowTier`, per group: counts by class, revisions, activity from `readGroupActivity(group)`. `readSlowTier` is `readLane(..., "slow")` plus the Stop wait and `pausesOnly`.
- **Lines** (`state/group-text.ts`): `groupTierLines(header, command)`, a line per group not all current, in `checks` order; `slow-text.ts` exports `pendingText` with `LaneWords`, `currentText`, `capitalized`, `sharedWaitText`. `headerLines` prints them after the slow-tier line (full form always, news when `groupTiersChanged`), then the commit line when `commitChanged`. `formatStatus` prints the group lines and the commit line after the slow-tier line.
- **Delivery.** `slow-told.ts`: `groupTiersChanged`/`tellGroupTiers`, own meta row `group-tiers-told:`. New `delivery/commit-told.ts`: `commitNews` makes a new report news by itself at a tool boundary (not at Stop, not for the idle waiter); without `checks` it marks the report told and says nothing. Registration tells the newest report, so a session is never told a commit made before it. New meta rows `groupTiersTold`, `commitTold` in `WORKTREE_META_ROWS`.
- **Fast work.** `isFastPending` subtracts `lanePending` when present; `worktreeLaneFiles` sets every group lane's files aside from a pathless `status --wait` edit window (`status-wait-edit.ts`), as slow files are.
- **Primer** (`primer.ts`, `coverage.ts`): with `checks`, `Coverage.groups` (moments in order, groups in `checks` order, `tests` last at `edit` while it owns a listed file or none is listed); the first sentence drops "after each edit"; the moments sentence follows it.
- **Lane readers.** `laneText` words `group:e2e:vitest` as `e2e vitest`; `next-step.ts` gives a group lane's running tier the slow tier's step unless the daemon published a yield standing for it; `standing.ts` reads a group lane's global setup (`isGroupLane`). `standing-yields.ts` `firstTier` keeps `isSlowLane`: rule C is about lanes that yield, and a lane string does not tell a `low` group from a `normal` one.
- **`squeal ps`** (`ps/host.ts`): counts permits in each `repo.<key>/` directory of every pool directory (listed by `isRepositorySlotDir`: `ps` knows no repository's key) and configured groups' `group.<name>.<i>.lock`, in the base and in the repository directories; a `pool.*.lock` in a repository directory is not counted. With neither, the reading is as before.
- **`Slow slot:`** (`status/slot-holders.ts`): `slowSlotDirOf` reads `capacity.groupSlotScope` from the host config on each call; `"user"` gives `slowSlotDir()` as before, `"repository"` `slotFiles("slow", scope).dir(slowSlotDir(), commonDir)`. Holders of a configured group's slot are not read: its line says capacity.
- **Skill** (source only): `policy.md` rows `stop.maxHolds`, `checks`, a "Host config" section with `capacity.groupSlotScope`, `slow.maxParallel` counted per repository by default; `reports.md` entries for group lines and the commit line, the group example being the formatter's exact output (`test/harness/skill-groups.test.ts`).

## Words chosen (the brief left them to this row)

- A lane waiting for a group it follows (019-10 decision 10, published as `waiting for fast`): `waiting for the unit group's files`, or `the tests and unit groups' files`; `an earlier group` when the group has no `after`. The default `tests` group is named `tests`, as `after` names it; the primer glosses it once: `tests (the test files no group selects)`.
- A `commit` group's pending files (no activity published, 019-10 decision 7): `N pending, waiting for a commit`; the moment clause is `Squeal runs them at each commit`.
- Moments in a group line: `after each edit` (with `once no edit came for 30 s` for `quietMs`), `when the agent pauses`, the same plus `, and Stop waits up to 2 min for them` for a group Stop waits for, `at each commit`; `and after the unit group's files` for `after`.
- The run command: `` `squeal run e2e --wait 60000` runs them now and waits for their results `` while the files wait for a moment (or are not queued); at `edit` with nothing waiting, `` waits for their results ``, as 004-83 named `run --slow --wait`.
- Primer clauses: `after each edit`, `between your turns`, `at Stop, and Stop waits for them`, `when you commit`; then `` `squeal run <group> --wait 60000` runs one now `` (the CLI's form under a long Codex path).
- Commit line: `commitReportText` as 019-13 wrote it, unchanged.

## Decisions

1. **Commit line only with `checks`** (the coordinator, 2026-11-03, answer B): Goal 2 wins over Goal 5; the report is still stored for every commit; spec D5 to be amended by the coordinator.
2. **A group's line only while not all current**, as D6 says; the slow-tier line keeps printing in every state.
3. **Lint groups** have no status line: they have no test files and no lane yet. The primer names them by moment.
4. **The commit line is never news at Stop**, and a full header (registration, Stop) prints it only when `commitChanged`; status prints it always.

## Found, not fixed

- `squeal retry` of a configured group's file (`src/core/retry/waits.ts`, `src/cli/retry-queue.ts`): `QueueReads.isSlow` is the slow group's, so a group file reads as a fast file waiting on its project's open runs. A per-ref activity (`readGroupActivity`) would fix it.
- `outstanding.ts` reads only the slow tier's activity for a pending file's reason; a group file's outstanding entry does not name its group's wait.
- `test/harness/skill.test.ts` "says the same step 4, `commands.md` and `policy.md` in the Codex and Pi copies" fails until the build copies `policy.md`; this row does not run the build.
- `squeal ps` classes a configured group's run `fast` whatever its priority (`ps/work.ts` reads only the `slowTier` row's running files; a configured group publishes in `groupTiers`), except under a `run --slow` checkpoint. `processes.ts` `runOf` keeps a `group:` mark `fast` to match; a comment says why.
- `test/status/retry-holds-live.test.ts`, `retry-holds.test.ts` and `test/cli/retry-queued.test.ts` do not stub `XDG_CONFIG_HOME`: status there reads the host's real config for the slot scope. They pass; their schedulers run with scope `"user"`.
- Under `"repository"`, a status read while the daemon waits for the slot calls `repositoryId(commonDir)`, which writes and removes a draft file in `<commonDir>/squeal/` (the daemon has already made the id).
- D5 step 3's refresh ("when the commit groups finish, a change delivery updates it once") is not done: the stored report has counts only (019-13 "Known limits").
