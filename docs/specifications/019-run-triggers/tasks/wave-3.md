# Spec 019 wave 3: the commit moment, and wording left from wave 2

Two rows in parallel on disjoint files, from main at 0.1.397. One candidate after both, one review. Read `spec.md` D1, D4 to D6, `reviews/0.1.396.md` S2 and `reviews/0.1.397.md` (both notes), and the notes in `tasks/019-13/`, `019-16/`, `019-21/`, `019-23/`.

## 019-22 Commit groups run at commit, and the report updates once

Use /worker. Shape: slice. Outcome: spec D5 steps 1 and 3. On a `HEAD` move to a commit Squeal has not reported, every group at `commit` runs: a test group's files that the commit's changed paths re-key, and a lint group's (`lint: true` or named tools) checks for the files the commit changed. When they finish, the stored report for that SHA is recomputed once and delivered once as a change (spec D5 step 3), also when an edit came between. `squeal run <group>` runs a lint group too (today it exits 2: `tasks/019-15/notes.md` decision 3).

Seam: `reportHeadMove` (`src/core/scheduler/head-move.ts`) and `Scheduler.requestGroup` (`scheduler.ts`); the lint pass's entry for named files (`src/core/lint/pass/`). Owns `src/core/scheduler/head-move.ts`, `scheduler.ts` (the commit trigger and `requestGroup` for lint groups only), `src/core/commit/*`, `src/core/lint/pass/*` (the commit-moment entry only), `src/core/daemon/run-group.ts` (lint groups), `src/core/delivery/commit-told.ts`, tests. Leave the files of 019-24 alone.

Done when: tests show a test group and a lint group at `commit` run once per new commit and never before; a report with running checks updates exactly once after they finish, including after an intervening edit; a pull or reset that moves `HEAD` to a known commit runs nothing new; `squeal run lint --wait` gives the lint group's verdict; nothing blocks or denies; affected tests by `squeal status --wait` (do not wait for the whole queue; report pending as pending); lint and typecheck. No build.

## 019-24 Wording and edge cases left from wave 2

Use /worker. Shape: repair. Four items, each with a test:

1. The `Slow tier:` line and the primer say Stop "holds the agent once" (`src/core/state/slow-text.ts`, `src/harness/shared/primer.ts`); with `stop.maxHolds` above 1 they say "up to N times in a turn". Byte-identical at the default 1.
2. The `status --wait` lines (`src/cli/status-wait-lines.ts`, `status-wait*.ts`) name a configured group's pending files by the group, as status does, not as slow files. Byte-identical without `checks`.
3. `squeal run <group> --wait <ms>` with a short wait on a daemon that answers its ping but not `run-group`: bound the request by the wait, and turn a socket timeout into the verdict exit 3 with a worded line, not a stack (review 0.1.397 note 1; `src/cli/run-group.ts`, `run-group-wait.ts`).
4. A queued same-key retry that reads pending in the header counts but current in its group drops the group's line (review 0.1.397 note 2; `src/core/state/groups.ts`, `group-text.ts`): one source of truth for the group's counts.

Owns the files named in 1 to 4 and their tests. Leave 019-22's files alone. Done when: a test per item on Claude Code and Codex where the text differs by harness; the golden no-`checks` texts unchanged; `squeal status --wait` on changed paths; lint and typecheck. No build.

## 019-26 Repair of cand/0.1.398 (review `reviews/0.1.398.md` FAIL, 2026-11-04)

Use /worker. Shape: repair. Baseline: cand/0.1.398 plus its review. Read the review's B1 to B3 and reproduce each first, then fix:

- **B1.** `squeal run <lint group> --wait` must not report a verdict while a check of the group is stale: a stale pass counts as pending in the CLI's read, as `releaseLintGroup` counts it (`src/cli/run-lint-group.ts`).
- **B2.** A commit group whose `after` names another commit group must not starve on the predecessor's files that the commit did not ask for: for the commit moment, a predecessor holds the follower only through the files the same commit asked it to run (`src/core/scheduler/commit-moment.ts`, `commit-asks.ts`, the `after` check in `slow-tier.ts`). Cover both review cases: the commit changes only the follower's files, and a selected predecessor file completes while an unasked sibling stays queued. The report must then complete and update once.
- **B3.** The lint group's daemon discovery and requests stay within the `--wait` budget, as 019-24 did for test groups (`socketBound`, `askWithin`; `src/cli/run-lint-group.ts`).

Owns those files and their tests. Done when: each review reproduction is a failing test before the fix and passes after; existing commit, lint, run-group and status-wait tests pass by `squeal status --wait` on changed paths (report pending as pending); lint and typecheck. No build.
