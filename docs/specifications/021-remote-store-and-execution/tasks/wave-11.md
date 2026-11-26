# Spec 021, wave 11: the recount's long turn (row 021-38)

The human, 2026-11-26 (coordinator 0fb097d5, from the lab investigation of task 877f10a7): fix the regression; keep prune correctness; do not raise the 100 ms line or add a tolerance. One row.

## 021-38: a recount's longest turn back under 100 ms, with the keyed count test kept

Use /worker. Shape: repair.

Outcome: `test/code/crap/chain-load.test.ts` "recounts 1263 sources of 10 functions with no long turn" passes its 100 ms line on a quiet host again, and the prune still tests a kept count by key under the write lock without a scan.

Evidence (bisected 2026-11-26, Ryzen 9 5950X, Node 24.21, load 2 to 4): 0.1.568 68 to 72 ms, 0.1.570 114 to 120, main `792ee0ccb` 125 to 153; the long turn is in the phase "in counting". First slow commit `8fe97c188` (row 021-33) added `states_by_blob` and `views_by_check` (`src/core/code/store/schema.ts`, `CODE_INDEXES`). Dropping only `states_by_blob` on main gives 82 and 83 ms; dropping only `views_by_check` changes nothing. So the cost is index upkeep while a recount writes about 12,600 states (`src/core/code/store/states.ts`, `upsertMany`, `adopt`).

Read: spec D3 and D22; `tasks/021-33-notes.md`; `src/core/code/store/prune.ts` (`UNUSED_COUNT`, `pruneCodeSlices`); `test/store/prune-plans.test.ts` and `test/store/prune-keyed.test.ts` (they fail on a scan).

Leads, not orders; measure before you choose and say why in `tasks/021-38-notes.md`:
1. Does the upsert touch the index for a state whose `blob` did not change? An `ON CONFLICT DO UPDATE ... WHERE` that skips unchanged rows, or leaving `blob` out of `SET` when equal, may remove most upkeep.
2. A narrower index (`blob` is a long hash text; the index key also carries the primary key), or another key test for "a kept state names this count".
3. Slice the recount's state writes so no single turn carries the upkeep, if 1 and 2 are not enough.

Also: with the index gone main reads 82 to 83 ms against 68 to 72 at 0.1.568. Find the cause if it costs under an hour (bisect with the index removed); say whether it matters.

Owns: `src/core/code/store/` (schema, states, prune), the recount write path it calls, their tests, `tasks/021-38-notes.md`. Leave alone: `test/code/crap/chain-load.test.ts`'s lines and budgets, `src/core/code/store/` open-time index build retry (row 021-35), `docs/board.md`.

Done when: the test passes three runs in a row on this host at load under 4 with Node 24 (`PATH=/opt/squeal-e2e/node24/bin:$PATH pnpm exec vitest run --silent=false test/code/crap/chain-load.test.ts -t recounts`; read "longest turn N ms"); the notes give N for 0.1.568, main and your head, three runs each, in one sitting, with the load average of each run; `prune-plans` and `prune-keyed` pass; a schema change keeps older daemons working on the same file (D4 additive rule) and existing stores gain or lose the index at open. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No full suite. Run direct Vitest with a timeout; leave no orphan processes. Do not run `pnpm run build`.
