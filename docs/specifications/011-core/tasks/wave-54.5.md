# Wave 54.5: repair of 0.1.357 B1 (row 011-254)

Coordinator 04a258b0, 2026-10-26. Review `reviews/0.1.357.md` FAIL on B1. One repair round, then one re-review; a second FAIL ends the loop.

## R1: row 011-254, worker 767601c0 resumed

Use /worker. Shape: repair.

Outcome: a daemon whose start is current reads as starting in every reader, also beside an `untilStart` stop mark; once that start ends, the same stored mark reads as stopped until `squeal start` again and still blocks every spawn.

Read: `reviews/0.1.357.md` (B1, its table, "Inputs for the repair wave"); `tasks/011-254/notes.md`; 011 C9's 011-251 and 011-254 paragraphs.

Base: your branch is behind the candidate. Reset it to cand/0.1.357 `2b6727237`, which holds your five commits on main 0.1.355 with 011-251's repair, and commit on top.

Seam and lead: `asTold` (`src/core/delivery/liveness.ts:206`) drops `stopped` and keeps `untilStart`, while `header.ts:201`, `outstanding-text.ts:178` and `status-detail.ts:88` read `untilStart` alone. Make one rule own the order: a current start (told, start mark, spawn mark) wins over a stop, and `untilStart` is read only with `stopped`. No new user-visible text; send me one first if you need it.

Owns: `src/core/delivery/liveness.ts` (`asTold`), `stopped.ts` (`asStopped`), `header.ts`, `format.ts`, `src/core/status/outstanding-text.ts`, `status-detail.ts`, `src/cli/wait-liveness.ts`, and their tests. Not yours: the stored mark's contract (`markStopped`, `heldStop`, `stopHolds`), the budgets, the board, spec text, bundles, version. No `npm run build`.

Done when: the true-mode stop-during-SessionStart case through the real `runHook` says starting while the start is current, alive after a heartbeat, and stopped until start after that daemon exits, with no spawn; each row of the review's table reads the same in status, `--full`, `--json`, a real header and the wait's judgment; the plain-stop, Git, worktree and no-store controls hold; lint, typecheck, `squeal status --wait 60000 <changed paths>`, `test/keys/key-format.test.ts` and the two `test/e2e/stop*.test.ts` files pass (they run the committed bundle). Commits and notes on your branch; reply with the commits.
