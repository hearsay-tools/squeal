# Spec 018 wave 18: more of squawk's files shared, every worktree served, a week measured

The human, 2026-11-12: "Rows: A: recording faults, B: first-importer fix, C: week-long measurement" (rows 018-43, 018-44, 018-45). Rows 018-43 and 018-44 run in parallel: disjoint files.

## 018-43 CI evidence matches the daemon's for spawn arguments, symlink removals and repeated test names

Use /worker. Shape: slice.

Outcome: on squawk's run 43188846583 parts re-recorded with this change, `ci export` exports at least 1568 + 31 of its test files instead of 1484 (`research/left-out-files.md`, causes A and B and the duplicate names), and no key changes.

Read: `research/left-out-files.md` (all of it; its probes under `research/probes/left-out-files/`), spec D8, D9, D11; `src/runners/vitest/ci-runtime/evidence-hooks.cjs`, `evidence.cjs`, `children.cjs`, `vitest-ci.cjs`; the daemon recorder's handling of spawn arguments (find it from the research's citations).

Items, each with a failing fixture test first:
1. `ci record` takes evidence of each spawned process's file-path arguments the way the daemon's recorder keys them (squawk's `pi-*.mjs` extension scripts passed to a mock program; `sgconfig.yml` to `sg`).
2. Removing or renaming a symlink no longer marks its target written (squawk's `cursor-print-runner.test.ts`).
3. `ci record` turns on Vitest's `includeTaskLocation`, so parts carry line numbers and the export names repeated checks as the daemon does (`it.each` with equal titles); state whether the environment comparison (D10) sees this option and keep it equal or tolerated.

Do not change D9 (evidence only from the file's own shard). Owns: `src/runners/vitest/ci-runtime/*`, `src/core/ci/*` only for item 3's naming, their tests. Leave alone: `src/core/shared/*`, `src/core/store/transfer-*` (row 018-44), `src/runners/node-test/*` (spec 020 row 020-36).

Done when: the three fixtures fail before and pass after; the key-format guard (`test/keys/key-format.test.ts`) passes without a version raise, or say which version it names and why; a replay with the research's probe on run 43188846583's parts (read-only download) gives the new export counts; lint, typecheck. No build, no full suite.

## 018-44 an import stays usable for every worktree whose environment matches CI's, whichever worktree imported it

Use /worker. Shape: repair.

Outcome: when worktrees share one store, the first worktree to import an export no longer decides for the others: a held import stored at CI's key (because the importing worktree's environment differed) still serves a later worktree whose environment matches, and a later worktree whose own environment matches re-keys or imports it for itself.

Read: `research/live-saving.md` Q3 and point 4; spec D3, D11, D14; `src/core/shared/reader.ts` (`#pass`: `nearestHeld` skips an export any worktree imported), `src/core/store/transfer-rekey.ts`, `src/core/store/transfer-import.ts` (`importSliced` from row 021-20), `src/core/store/imports.ts`.

Starting seam: what "held" means in `#pass`: an import that this worktree can use, not any row in `imports`. First a failing test with two worktrees on one store: worktree X (environment differs from CI) imports first; worktree Y (environment equals CI) then gets current results from that export.

Owns: `src/core/shared/*`, `src/core/store/transfer-rekey.ts`, `transfer-import.ts`, `imports.ts`, their tests. Leave alone: `src/runners/*` (row 018-43), `src/core/status/*` unless status must name it (then say so first). Keep the D21 refusal record order and the sliced import (row 021-20) as they are.

Done when: the two-worktree test passes; no fetch is repeated when the export is already usable; lint, typecheck, `squeal status --wait 60000` on the changed paths; the key-format guard passes. No build, no full suite.

## 018-45 a week of adoptions in squawk

Shape: measurement (research). The human approved a week-long measurement. `research/live-saving.md` Q5 and its recommendation 3: the store cannot answer later, because worktrees take their rows with them and `last_used_at` keeps only the last lookup.

Plan: a read-only snapshot script under `research/probes/live-saving/` takes, per squawk worktree, the current file states with their origin (imported or local), the import ids and the local run seconds since the last snapshot. A daily scheduled task runs it for 7 days (2026-11-13 to 2026-11-19); a researcher then writes `research/week-of-adoptions.md`. Read-only on every store; it starts and stops nothing.

Running (2026-11-12): the first snapshot is in `research/probes/live-saving/week/`. A background job (`hsq job start squeal-018-45-week`, pid in `~/.local/share/squeal-018-45-week/*.log`) runs `snapshot.mjs` once a day at 16:30Z from 2026-11-13 to 2026-11-19 into `~/.local/share/squeal-018-45-week/out/` (outside every checkout; its `loop.log` records each run). After 2026-11-19 16:30Z: copy `out/*.json` into `research/probes/live-saving/week/`, then one `/researcher` writes `research/week-of-adoptions.md` from them and `research/live-saving.md`. Starting that session is the human's call (no scheduled session without the human's ask, CLAUDE.md "Starting sessions").


## Review of candidate 0.1.459 (rows 018-43, 018-44)

Use /reviewer. Shape: review. Candidate `cand/0.1.459` at 3ba1abc77; range `3784637e2..3ba1abc77` (main 0.1.457 plus 018-43, 018-44, docs and bundles). Write `reviews/0.1.459.md` and commit it on your branch.

Read: spec D9 (amended 2026-11-12 for repeated names), D10, D14, D21; `research/left-out-files.md`; `research/live-saving.md` (first-importer defect); `tasks/018-43/notes.md`, `tasks/018-44/notes.md`; `status.md` 2026-11-12 lines.

Check above all: 018-43 adds no evidence the export may not certify (spawn-argument rule equals the daemon recorder's; symlink removals; `includeTaskLocation` changes no key, D10); 018-44 fetches an export at most once per environment, never loops a fetch on restart, keeps the D21 refusal order and sliced import (row 021-20), and an old file-only import id still reads right. Say whether the accepted gap in `status.md` is a blocker.

Done when: findings file with PASS or FAIL, blockers proven by a test or a reproduction in a scratch HOME. Lint, typecheck, `squeal status --wait 60000` on paths you touch; direct `pnpm exec vitest run <paths>` when Squeal is queued. No full suite, no `pnpm run build`.

## Re-review of candidate 0.1.459 after repair B1

Use /reviewer. Shape: review. Candidate `cand/0.1.459` at be0948131; range `3ba1abc77..be0948131` (review file, repair 143dd863d, status line, bundles). Read `reviews/0.1.459.md` (B1 and its reproduction) and the 2026-11-12 review line in `status.md`. Append a "Re-review" section to `reviews/0.1.459.md` with PASS or FAIL for be0948131 and commit it.

Check: B1's reproduction (now the third test in `test/shared/import-each-worktree.test.ts`) fails before 143dd863d and passes after; no restart in an unchanged environment fetches or adds an import; file-only ids from `squeal import` and from 0.1.455-era reader imports still serve (one extra fetch after upgrade is acceptable, a repeating one is not); D21 order, sliced import and the final-record rule unchanged. New findings only for the repair's range.

Done when: findings appended; lint, typecheck, direct `pnpm exec vitest run` of `test/shared/` and the key-format guard. No full suite, no build.
