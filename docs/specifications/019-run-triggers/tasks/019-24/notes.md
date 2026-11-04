# 019-24 notes: wording and edge cases left from wave 2

Worker 68f6aed7, 2026-11-04. Brief `tasks/wave-3.md`. Baseline main at 0.1.397 (`6d265bb84`). Commits `5750bae7c` (item 1), `7d8098a3f` (item 2), `f8c04258e` (item 3), `55eea438f` (item 4).

## What changed

1. **Holds per turn** (spec 019 D4 step 3). `holdsText(maxHolds)` (`src/core/state/slow-text.ts`) is `once` at 1, else `up to N times in a turn`. The `Slow tier:` line reads `SlowTierState.maxHolds`, set by `readSlowTier` only while Stop waits for slow files and `stop.maxHolds` is above 1. The primer reads `Coverage.slow.maxHolds`, set by `coverageOf` above 1. Both are additive and absent at 1, so the texts and the JSON at the default are byte-identical. `GroupTierState` and `LaneState` omit `maxHolds`: a group line says "Stop waits up to N for them" and no holds.
2. **`status --wait` names groups** (spec 019 D6). New `src/cli/status-wait-groups.ts`.
   - Quiet line: `groupsQuietText` adds a clause for each configured group not all current, after the slow clause, in `checks` order. It uses the group line's words for when the group runs and for its command (`groupWhenText`, `groupRunText`, now exported from `group-text.ts`). For a group Stop waits for: `; 2 e2e test files are not current and Squeal runs the pending ones when the agent pauses, which this wait does not hold for: `squeal run e2e --wait 60000` runs them now and waits for their results`. For any other group, the slow clause's "this repository does not require them before you finish".
   - Named wait and `status <path>`: `leftGroupsOf(root, leftForPause)` sets the additive `leftGroups` on the result, only with a `checks` key. `pauseText` then gives one clause per group. The default `slow` group keeps the slow words. A configured group is named by its name and `squeal run <group>`: ``1 e2e test file waits for a pause or `squeal run e2e`, which this wait does not hold for: …``. When the wait selected only such files, the reason is `every selected test file waits for its group's moment`.
3. **`run <group> --wait` on a stalled daemon** (review 0.1.397 S1). `askWithin(socket, request, deadline)` (`run-group-wait.ts`) waits up to `socketBound(deadline)`: what is left of the wait, at most 2 s and at least 50 ms. It never throws. A socket with no answer gives ` before the deadline`, ` within 2 s` or `: <error>`, and the command words it on its no-verdict path: exit 3 with `--wait`; without `--wait`, exit 1 and the text on stderr. The `run-group-status` poll and its sleep are bound by the deadline too. A poll with no answer before the deadline is `pending`, which prints the existing "deadline passed before the daemon took request …" line. The wait's ping is bound too. A ping with no answer is a busy daemon, so the store still decides. Only `null` (no daemon listens) is "stopped". `askDaemon` and `daemonSocket` take an optional timeout, default 2 s (additive). `run-group.ts` lines 75 to 79 (the lint-group block, 019-22's) are untouched.
4. **One classification for a group's counts** (review 0.1.397 S2). `classifyGroupFiles` (`groups.ts`) classes a configured group's files by `fileClassOf`, as the header's `testFileCounts` does. `readLane` takes the classifier, default `classifySlowFiles`, and `laneChecks` is shared. The default `slow` group keeps `classifySlowFiles`. So its line, `status --wait`'s slow clause, `run --slow --wait` and Stop's `stopRequired` read as before. A test pins that a same-key retry still reads current there without `checks`.

## Decisions (the brief left them to this row)

- Item 1 wording: `holds the agent up to 3 times in a turn` (line) and `Stop waits or holds you up to 3 times in a turn.` (primer). The primer sentence grows by 20 characters only above 1. The primer folds as before at its cap.
- Item 2: the quiet clause is added whatever `wait.slow` is. `run --slow --wait` held only slow files, not a group's.
- Item 2: words for what a left file waits for, by moment: `a pause` (pause, stop), `a commit`, `the group's turn` (edit). Since 019-25 a named wait leaves out only a file of a group at pause, stop or commit, so `the group's turn` is not printed today.
- Item 3: the 50 ms floor lets a daemon that answers at once be heard at the deadline. Overshoot is at most 50 ms. Without `--wait` the command keeps exit 1 but words the failure, where it printed a stack before.
- Item 3: tested in process through `main`, not the built bundle: this row runs no build. The review's earlier source-level probe saw `main` reject. It now resolves to 3.

## Found, not fixed

- The skill's `commands.md` (`## squeal run --slow`) quotes the line's ending as `Stop waits up to … for them or holds the agent once`. Above `stop.maxHolds` 1 the line ends `… holds the agent up to N times in a turn`. Step 4 keys on `Stop waits`, which still matches. The skill copies are not this row's.
- Moved to row 019-25 (the coordinator, 2026-11-04, reply to request 6d6a1b2a): a named wait's class line and timeout reason call a configured group's queued file `slow, … on `squeal run --slow`` (`queuedReason`, `nextStep`, `namedStep`). Under `slow.trigger: "continuous"` a named wait holds for a pause, stop or commit group's file until its deadline (`pauseOnlyIds` leaves files out only under `"idle"`).

## Tests

- `test/status/slow-holds-text.test.ts`: the line at `maxHolds` absent, 1 and 3, in status and both header forms, with `squeal` and the Codex path. No holds while Stop does not wait for slow files.
- `test/harness/primer-slow-policy.test.ts`: at 3, in Claude Code, Codex, Pi and OpenCode. At 1 the primer equals the default. Off, no holds.
- `test/cli/status-wait-groups.test.ts`: the quiet clause, for a group Stop waits for (with `squeal` and the Codex path) and for a commit group. No clause when the group is current. The named wait's clause at stop (both commands) and at pause. `status <path>`. The no-verdict reason when only the group's file is selected.
- `test/cli/run-group-stall.test.ts`: four cases. A stalled `run-group` under `--wait 300`: exit 3 within 1.5 s, with a line. A stalled `run-group-status`: the pending line, exit 3. No `--wait`: stderr text and exit 1, about 2 s. A stalled ping during a 5.5 s wait: the deadline line, exit 3.
- `test/status/group-retry-counts.test.ts`: a queued and a running same-key retry give equal header and group counts, and the group line stays (also with the Codex path). The default slow reading without `checks` is unchanged.
