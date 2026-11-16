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

## Review of cand/0.1.527

Use /reviewer. Shape: review. Pinned to the `cand/0.1.527` SHA named in the spawn; the range is from the base named there to that SHA. It holds rows 005-90 and 005-91: ten commits of worker bacce449 (cherry-picked with `-x`) and one coordinator commit (the release 0.1.527 with bundles; in it also: the title says "your edit affects N test files", not "re-keyed", and `lintWords` split out of `contentWords`, which was over the complexity threshold). Read rows 005-90 and 005-91, this file, `tasks/005-91/notes.md`, `research/hook-messages-2026-11-16.md` findings 2, 7, 9, 10, 11, `status.md` 2026-11-16, `docs/vision.md` principle 1.

Judge:
- 005-90: while the test files are not listed, no hook text and no `squeal status` text reads as a result (no zero counts, no "Known failures: 0"); a failure the store holds is still said; a listed worktree is byte-identical; the state ends when the listing lands (no stale "still starting").
- Resume: a resumed session is registered and swept as before and gets no primer; `compact`, `clear`, `startup` and a subagent start unchanged in every harness that shares `session.ts`; a first registration at a tool boundary still carries the primer.
- Heartbeat: under 60 s no delivery is only that notice or its recovery, and no recovery is sent for a notice that was never sent; over it, each once; the header sentence and the `Not validated:` line unchanged; no notice is lost for a stopped, stopping or absent daemon.
- Group lines: first time and on a change of kind only; the stored told value's format change (one more line after an upgrade) is safe for a consumer registered by an older version; the slow-tier line unchanged.
- Titles: each names what the delivery carries; no parser in `evals/` or a harness reads the old bare title and now misreads; the 0.1.393 control's `accepted` list maps only intended differences.
- Every changed sentence against the human's test: it is for the agent in the session.

No full suite and no full-suite checkpoint; candidate CI is the full suite: name its run and result. `test/e2e/**` is outside Squeal's coverage: say which e2e files you ran directly. Write `reviews/0.1.527.md` and commit it on your branch.
