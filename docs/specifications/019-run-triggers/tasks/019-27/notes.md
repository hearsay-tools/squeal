# 019-27 notes: the last small fixes

Worker af811454, 2026-11-04. Brief `tasks/wave-4.md`, 019-27. Base `0195b5590` (main at 0.1.398 plus the wave 4 briefs). No build: the bundles and the skill copies are the candidate's.

## What changed

1. **Skill, Stop's holds.** `commands.md`, `## squeal run --slow`: the `Slow tier:` line's ending is `Stop waits up to … for them or holds the agent …`, and Stop keeps the agent going at most `stop.maxHolds` times in one turn, as `policy.md` says; both printed endings are quoted (`once`, `up to 3 times in a turn`). Source only. Test: `test/harness/skill.test.ts`, the old sentence updated and "reads Stop's holds in `commands.md` as `policy.md` does".
2. **Retry of a configured group's file.** `RetryWait` gains `{ kind: "group", group, at, after, lane }` (`types/standing.ts`); `lane` is what the group's lane published: `{ kind: "running", since }`, `{ kind: "waiting", for }` or `null`. `QueueReads.groupOf` (optional) gives the owning configured group and its lane state; `groupLanesOf(groupTiers, ownerOf)` builds it from `GroupTierState`s. Status (`outstanding.ts`) builds it from `header.groupTiers`; `squeal retry` (`cli/retry-queue.ts`) from `readGroupTiers`, only with a live daemon. A group lane's run is no longer a fast file's tier or "fast work". `holdText(wait, command)` now takes the command; `retryStartText` defaults it to `squeal`, as the rest of `squeal retry`'s text does. Tests: `test/status/retry-holds-group.test.ts`, `test/cli/retry-queued-group.test.ts`; both fail on the old code (8 of 8 and 3 of 4; the no-daemon case is unchanged on purpose).
3. **`#normalIdle`.** It reads `#groupHolds` (the `after` rule of 019-26) instead of `#groupBusy`, which is gone. A `normal` group is busy with a tier in flight or a queued file that runs without a further ask: at `commit` only a file a commit asked for, a request or an explicit checkpoint covers; at `edit`, `pause` and `stop` every queued file, as before (the coordinator confirmed this reading, request 22d0cf8d, answer A). Test: `test/scheduler/group-lanes-width.test.ts` (one tier of both files beside an unasked commit file; one file a tier while the commit group's requested file runs).
4. **`SlowTier.next`** 27 to 9: `#guardOf`, `#mayStart`, `#want`, `#takeSlot`, `#launch`; same order of reads and side effects. `test/scheduler/slow-tier.test.ts` unchanged and passing.

## Words chosen

A queued retry of group `e2e`'s file, after `it has not started` (`squeal retry`) or `queued and not started` (status):

- lane running: `: the e2e group runs other files, since 12:00:03`
- waiting for `after`: `: the e2e group waits for the tests group's files` (`followedGroupsText`, exported from `group-text.ts`, the group line's words)
- slot: `: the e2e group waits for capacity; whether the e2e group's slot or the shared worker pool holds it is not known`
- pool: `: the e2e group waits for the shared worker pool`
- load: `: the e2e group waits for the host load to drop; `squeal run e2e` runs it now`
- pause: `: the e2e group waits for the agent to pause; `squeal run e2e` runs it now`
- `commit`, nothing published: `: the e2e group runs at a commit only the files that commit changes; `squeal run e2e` runs it now`
- other moments, nothing published: `; what holds it in the e2e group is not known`

The run command is named only where a request advances the file: it ignores the moment (D1) and skips the load guard (D3). It does not shorten a running tier, a wait for `after`, or capacity.

## Files outside the brief's list, touched for these items

- `src/cli/retry-queue.ts`: the reader `squeal retry` uses (019-16's note names it).
- `src/core/status/outstanding-text.ts`: passes `command` to `holdText`, so the status line names the CLI's own form.
- `src/core/state/group-text.ts`: `followedGroupsText` exported; `after(group)` became `afterText(names)`. Group lines unchanged (`group-lines.test.ts`, golden tests pass).
- `src/core/types/standing.ts`: the additive `RetryWait` member.

## Checks expected to fail until the build

The build is not this row's. These fail on the committed bundles and copies, by drift only: `test/harness/skill.test.ts` "says the same step 4, `commands.md` and `policy.md` in the Codex and Pi copies"; `test/harness/codex/packaging/runtime.test.ts` (skill copy, bundles); `test/harness/pi/package.test.ts` (skill copy, bundles); `test/harness/opencode/package.test.ts` (bundles); `test/harness/plugin.test.ts` "bundles are committed exactly as `npm run build` produces them".

## Known limits, not in this row

- `squeal ps` still classes a configured group's run `fast` (019-16's note).
- A retry's `waits` for a group file reads `groupTiers`, which `readHeader` sets only with a `checks` key; configured groups exist only then.
