# Spec 019 wave 7: what dogfood Round 2 found

From `lessons.md` Round 2 (019-33), proposed rows P9 to P11 (P8 waits for the human). Three rows in parallel on disjoint files, from main. Each proposal, reproduction and done-when is in `lessons.md` Round 2 "Proposed rows"; read it first.

## 019-35 the commit update runs when lint records (P9)

Use /worker. Shape: repair. `updateCommitReport` (`src/core/scheduler/head-move.ts`) also runs after a lint pass records, so an update whose only commit work is lint is stored when lint's record lands, with no test tier and no interval pass between. Owns `src/core/scheduler/head-move.ts`, the lint pass's record hook it needs (`src/core/lint/pass/` record step only), tests. Done when: P9's done-when test; existing commit and lint tests pass by `squeal status --wait` on changed paths (pending reported as pending); lint and typecheck. No build.

## 019-36 the first Stop's 2 s entry with news waits for the record without an open transaction (P10)

Use /worker. Shape: repair. The 2 s entry waits for the waiting entry's record before it prepares its news, or polls without the open write transaction. Owns `src/harness/shared/stop.ts`, `stop-decide.ts`, `stop-slow.ts`, tests. Done when: P10's done-when (019-30's harness test with an untold result at the first Stop, Claude Code and Codex: the waiting entry decides, one hold) and `docs/specifications/019-run-triggers/tasks/019-33/bin/p3probe.mjs 4 150` gives no hold from the 2 s entry (read the script before running it; it runs no agent); Stop tests pass by `squeal status --wait`; lint and typecheck. No build.

## 019-37 a commit's not-determined files are named, and the clean-tree cause is found (P11)

Use /worker. Shape: repair. `squeal status --full` lists the commit line's not-determined files with the paths that make them so; then find why a clean cezarion tree read one test file "not determined (unstaged changes)" in s1c (`tasks/019-33/notes.md` for the setup; reproduce in a `git bundle` copy of cezarion under `$TMPDIR`, never in its checkout), and fix the cause or make the line say why. Owns `src/core/commit/compute.ts`, `report.ts`, `text.ts`, the status formatter's commit part (`src/core/status/`), tests. Done when: a test where a not-determined file is named with its path; the s1c cause fixed with a test, or explained in `tasks/019-37/notes.md` with the line's wording changed; lint and typecheck. No build.
