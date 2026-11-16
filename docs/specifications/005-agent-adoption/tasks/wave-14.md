# 005 wave 14: fewer messages, and a worktree with no results yet

Rows 005-90 and 005-91, one worker (both cross `header.ts`, `format.ts` and `delivery.ts`). From `research/hook-messages-2026-11-16.md`; rule in `status.md`, 2026-11-16, and `docs/vision.md` principle 1. Coordinator: session 4d2ecbfc. 005-93 (late and caught-up messages) follows this wave on the same files: leave `src/core/delivery/edits.ts` and the edit lines alone.

No version raise, no `pnpm run build`, no full suite. Verify with `squeal status --wait 60000 <changed-path>...`. `test/e2e/**` is outside Squeal's coverage here: run the e2e files that pin delivered text directly, one at a time, with `timeout 900 node_modules/.bin/vitest run <file>`; at least `test/e2e/run-triggers-control.test.ts` (it compares texts with 0.1.393 through its `accepted` list; add each intended difference there) and `test/e2e/lifecycle.test.ts`. Grep `test/e2e` for every sentence you change.

## 005-90 and 005-91

Use /worker. Shape: slice. Outcome: an agent gets fewer messages at tool boundaries, each titled by its content, and a worktree with no results yet says so.

Read: research findings 2, 7, 9, 10, 11; rows 005-90 and 005-91; 005 D6; 001 D9; 011 C6.

Commit per part, in this order:

1. **No results yet (005-90).** While `testFilesListed` is false: the registration, the news header and `squeal status` print no zero counts and no known-failure count. They say: "Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change." Keep the daemon sentence (starting, stopped, none) after it. Seam: `src/core/delivery/header.ts` (`fullLine`, `newsLine`, `NOT_LISTED_SENTENCE`), `format.ts` (`formatRegistration`'s `Known failures` line), `src/core/status/format-status.ts`. First edit: a `formatRegistration` test at revision 0, unlisted, red while it prints "0 current".
2. **A resumed session (005-91 d).** `src/harness/shared/session.ts` treats source `resume` as `startup` and sends the whole primer again. On `resume` with a store: sweep and register as now, send the registration with no primer. `compact` and `clear` unchanged. Say in your final message what a tool-boundary registration (`deliver.ts`, `withPrimer`) should do, with evidence of when it happens; change it only if it is a resume.
3. **Heartbeat (005-91 a).** No delivery whose only news is a late heartbeat, or its recovery, while the heartbeat is less than 60 s late (one named constant; the daemon's own interval times a factor if that reads better: say which). A longer one sends once, and its recovery once. The header of any other delivery still says the heartbeat is late. Stopped, stopping and no-daemon messages unchanged. Seam: `src/core/delivery/liveness.ts`, `delivery.ts`.
4. **Group lines (005-91 b).** A news delivery carries a group's line the first time for a consumer, then only when the group's state changes kind (a failure, all current, waiting again), not when a count moves. Seam: `src/core/delivery/slow-told.ts` (`groupTiersChanged`); the slow-tier line follows the same rule if it shares the code.
5. **Titles (005-91 c).** No delivery is titled only `SQUEAL · revision N`: the first-edit line, owed counts, a group line and a commit line each give the title its words. Seam: `format.ts` `titleOf`.

Owns: the files named above, their tests, `evals/` parsers these texts move (round-trip the real formatters, old and new text), the `accepted` list of the 0.1.393 control. Leave alone: `src/core/delivery/edits.ts`, `editLines`, `primer.ts`, failure blocks (005-92), the Stop texts unless a shared function moves them (say which).

Done when: a test per part, red first; texts of every harness that share these functions still parse; lint, typecheck, affected tests current; the two e2e files above pass.

Final message: each text before and after; the threshold you chose and why; the tool-boundary registration finding; every e2e file you ran with its result.
