# 019-22 notes: commit groups run at commit, and the report updates once

Worker 1e5b4be8, 2026-11-04. Spec 019 D5 steps 1 and 3, D6 for lint groups. Baseline main at 0.1.397 (`6d265bb84`).

## What changed

- **Test groups at `commit`** (`src/core/scheduler/commit-moment.ts`, `commit-asks.ts`). On a move to a commit Squeal has not reported, `reportHeadMove` reads `git diff --name-only --no-renames <old HEAD> <new HEAD>` (`commit/tree.ts` `changedPaths`; every committed path when no `HEAD` was looked at before) and `askCommitGroups` asks each configured test group at `commit` for its files whose closure holds a changed path (every file of the group when a changed path is an environment input). Only files whose key is the commit's (no closure path or environment input differs from the working tree) and that are not current. A miss is queued as `queueGroup` does.
- **The lane's ask** (`SlowTier.asks`, a `CommitAsks`). It maps a file to the key the commit gave it. `#trigger` lets a file run while its key is the asked key. An edit that re-keys it before it runs leaves it to the next commit. `#candidates` prunes an ask once its file is not pending, or neither its key nor its key in flight is the asked one. `#drainable` lets asked files drain before exit.
- **The scheduler hands its lanes** to the commit moment at start (`attachCommitLanes`, a per-context `WeakMap`, as `head-move.ts`'s `looked`). `batch.ts` and `context.ts` are unchanged.
- **The report waits** (`commit/report.ts`): `waiting` lists the test files counted running (project, path, key) and the lint checks it waits for (tool, path, committed blob). `updated: true` marks the one update. Both parse additively; an older row parses without them.
- **The one update** (`head-move.ts` `updateCommitReport`). Called by every pass that does not move `HEAD` and after each tier's record (`Scheduler.#updateCommit`, a failure is a note). Only the newest report, and only while it names the `HEAD` last looked at. When every test entry ended (`testWaitEnded`) and every lint entry ended (`lintWaitEnded`), the report of the same SHA is made again (`commitReport`, asks off) and replaces the old one in place (`replaceCommitReport`) with `updated: true` and no `waiting`. A newer report makes every older one drop `waiting` (`writeCommitReports`), so only the newest can update.
- **Delivery** (`delivery/commit-told.ts`). The told slot is `<sha>` for the report and `<sha>+` for its update (`toldId`, read from the stored report), so the update is news once. Never at Stop, as before.
- **Held checks count as no result.** A queued file of a `commit` group that no commit asked for at its key runs for no one: `testTally` counts it unknown, not running. A pending lint check of a tool held for a commit, its path not released at the committed blob, counts not determined (`lintTally`). Neither is waited for.
- **Lint groups at `commit`** (`lint/pass/commit-entry.ts`, the pass's commit-moment entry). `heldForCommit(policy, tool)`: the first lint group that selects the tool is at `commit`. The pass keys such a tool's checks at each edit, as before, and a key with a stored result is still taken, but `lintParts` (`readQueue`) lints a pending or stale path only while the record `lint-release:<scope>` holds it at its blob now (`commitHold`, `releasedNow`). A release whose path no longer waits at its blob is dropped at the next pass. A held path keeps its quiet mark, so a first keying still lints with no transition once released. `forgetRecords` deletes the record.
- **The commit releases** (`commit/lint.ts` `commitLint`): each held tool whose pass has keyed (`lint-cursor` present) releases the changed paths whose working-tree file is the commit's, at the committed blob. The report waits for each released path and each check counted running. `lintWaitEnded`: a tool's entries end with lint off, the tool off (`lint-off`), or a pass that never keyed; else once its cursor reached the report's revision and each entry is not pending, is no longer that blob, or is held unreleased.
- **`squeal run <lint group>`** (`Scheduler.requestGroup`, `releaseLint`, `releaseLintGroup`). Releases every pending or stale check of the group's tools at its working-tree blob (only for a held tool; other tools lint at edit anyway) and answers how many wait. Then it asks the change feed for a pass (`passes.pass`), whose end runs the daemon's `afterBatch`, which nudges the lint pass. `src/core/daemon/run-group.ts` needed no change.
- **CLI** (`src/cli/run-lint-group.ts`; agreed with the coordinator 2026-11-04, request b166dde6). `run-group.ts` hands a lint group to `runLintGroupCommand` (one call and its import; its doc line and the exit-2 test case follow). Each socket call is bounded by what is left of the wait, and a socket that does not answer is "no verdict", exit 3, without a stack (as review 0.1.397 S1 asks for test groups).

## Words chosen

- Request: `Group lint requested at revision 3: 2 lint checks queued; they lint now.`; nothing waiting: `No lint checks of group lint to lint at revision 3: none is pending.`
- Verdict: `Group lint completed: no lint findings in 2 files` (exit 0); `Group lint completed: lint findings in 1 of 2 files; \`squeal lint\` lists them` (exit 1).
- No verdict (exit 3): `the deadline passed with 1 lint check pending; the group goes on in the daemon`; `1 lint check changed after the request and waits for a commit`; `N lint checks could not be linted`; `the group has no lint checks`; `lint is off: lint.enabled is false in squeal.config.json`; `the lint store cannot be read`; `no daemon is running; start one with squeal start`; `the daemon did not answer (<error>)`; `the daemon stopped before the group's lint checks were linted`.
- The commit line's words are 019-13's, unchanged. The update says what the recount says.

## Decisions the spec did not settle (my choices)

1. **Which files a commit runs.** The brief's rule (closure holds a changed path), narrowed to files whose key is the commit's. A file whose closure also differs from the working tree (partial staging) is not run: its result would be the working tree's key, not the commit's (open question 4).
2. **The update waits for every running check**, the default `tests` group's and a `pause` or `stop` group's included, not only the commit groups': the report's "still running" part ends only then. A check that cannot end for the commit (an edit re-keyed it, a held one) ends the wait.
3. **The update is a recount, not a key lookup** (review 0.1.396 S2 allows either). It reads the working tree when it runs: a check an edit re-keyed since the commit counts as not determined, never as the commit's. A failed recount (a git error) replaces the report as failed, with no `updated` mark.
4. **Only the newest report updates**, and only while `HEAD` is its commit. A move back to a reported commit runs nothing and updates nothing.
5. **A held lint check counts not determined**, a held test file unknown: neither runs for the commit, and "still running" would never end.
6. **Release by changed path, not by lint state.** The lint pass keys an edit asynchronously, so a commit can come before the pass made the path pending. The release names every changed path the commit holds and the working tree matches; a path no tool lints is dropped at the next pass.
7. **A consumer registered between the report and its update is told the update**: registration records the report as it stands (`<sha>`), and the update (`<sha>+`) is a change after that registration.

## Known limits

- **Asks live in memory.** A daemon restart between a commit and its run loses the asks: the asked files stay queued for the next commit, and the report counts them unknown at its update. A lint release survives (it is a lint store record).
- **A lint-only update waits for a pass.** The lint pass does not tell the scheduler when it ends; the update comes at the next pass that does not move `HEAD` (the idle pass, at most its interval) or the next tier's record. `LintPassOptions.onPass` could call `updateCommitReport`, but it is wired in `daemon.ts`, outside this row.
- **Lint groups at `pause` or `stop`** are not held: lint still runs at edit for them, as before. Only `commit` holds.
- **A held tool's checks read pending in status and `squeal lint`** until a commit or `squeal run <group>` lints them. 019-16 decision 3 left lint groups without a status line; none says "waits for a commit".
- **`squeal run <lint group>` triggers one change-feed pass** (a full reconcile), so the lint pass is nudged without `daemon.ts`.
- **No real-daemon test** of `squeal run lint --wait`: the CLI test uses the fake daemon and a real lint store; the scheduler and lint pass test runs `requestGroup` against the real lint pass with a fake provider.

## Tests

- `test/scheduler/commit-groups.test.ts`: a test group at `commit` runs once per new commit, only the files the commit changed, never at an edit; a report with a running file updates exactly once after it ends, with an edit between (counted by the store's writes); an edit that re-keys an asked file before it runs leaves it to the next commit; a reset to a reported commit runs nothing.
- `test/scheduler/commit-lint.test.ts`: the scheduler and the real lint pass on one repository. A lint group at `commit` lints nothing at an edit, lints what a commit changed once, and the report updates once; an edit before the lint run leaves the file to the next commit and the report updates once; `requestGroup("lint")` lints the waiting checks.
- `test/lint/pass/commit-entry.test.ts`: ownership by the first lint group; a release lints only the released path at its blob; a spent release is dropped; `releaseLintGroup`; no hold without a lint group at `commit`.
- `test/delivery/commit-update.test.ts`: the report and its update are each news once; never at Stop; an older report drops its wait.
- `test/cli/run-lint-group.test.ts`: the request line; the verdict codes 0, 1, 3; a released check waited for; a held one; no daemon; a daemon that answers its ping but not `run-group`, bounded by a 300 ms wait.

## Next

- If wanted: wire `onPass` of each lint pass to the scheduler's update in `daemon.ts`, so a lint-only update comes when the pass ends.
- Status or `squeal lint` wording for a held tool's pending checks ("wait for a commit").
- The bundles drift from the source until a build (`plugin.test.ts > bundles`, the Codex runtime, the Pi and OpenCode packages): this row runs no build.
