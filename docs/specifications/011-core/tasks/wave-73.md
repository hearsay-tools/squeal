# Wave 73: row 011-312 (a session that changed nothing is not held at Stop)

Coordinator d64f8c13, 2026-11-10. The human approved option A of the #153 card ("Fix no-edit case"). Users see this change.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-312

Use /worker. Shape: slice, test first, one commit.

Outcome: a session that changed nothing is not held at Stop for lint or tests of files it never touched, and a daemon stopped on purpose never causes a hold Squeal cannot clear.

Read: board row 011-312; `research/issue-153.md` (sections 1 and the recommendation); spec 011 C8; spec 019 D4; `src/harness/shared/no-edit.ts` and its doc comment (task 004-67).

Seam and lead: `unchangedSinceRegistration` (`src/harness/shared/no-edit.ts`) is the one owner of "this session changed nothing"; keep it the only one. First edit: a test where a main agent registers while the daemon's start scan has not finished, edits nothing, and Stop with one pending untouched lint check returns no hold (red today). Then record the commit `HEAD` names at registration (`tellRegistered`, `src/core/delivery/registered.ts`) and accept a second proof: no revision since registration, `HEAD` unchanged, and Git reports no change to tracked or untracked non-ignored files. Callers: `stop-required.ts:123` (drop the `MAIN_AGENT` limit), `stop-slow.ts`, `stop.ts`.

Stopped on purpose (a stop mark, `squeal stop` or `--until-start`): open lint and test checks become an information line, never a hold, and no line names `squeal run lint --wait` or another command that exits 3 without a daemon. A crashed daemon keeps today's behaviour.

Owns: `src/harness/shared/no-edit.ts`, `stop-required.ts`, `stop-slow.ts`, `stop.ts`, `stop-lint.ts`, `src/core/delivery/registered.ts`, their tests, spec 011 C8 and 019 D4 sentences on this rule. Ask first before touching other files, and before changing any key or store format.

Done when: the row's done-when holds; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`; `tasks/011-312/notes.md` lists deviations and the limit for edits to Git-ignored files Squeal tracks.

## R1: review of cand/0.1.429

Use /reviewer. Shape: review. Pinned to `cand/0.1.429` at `d8bac243f28a68808c3a59776cf2869f7c3ed8b6`; range `bf320db00..d8bac243f` (worker commits, the 004 D9 amendment, version and bundles).

Outcome: a PASS or FAIL verdict on row 011-312, written to `docs/specifications/011-core/reviews/0.1.429.md` and committed on your branch.

Read: board row 011-312; W1 above; `tasks/011-312/notes.md`; spec 011 C8, 019 D4, 004 D9; `research/issue-153.md` section 1.

Check first: an edit no daemon observed (before the start scan, while stopped, across a daemon replacement) can never read as "changed nothing"; Git is read only when it can decide, bounded, and its failure means "not proven"; the stopped-on-purpose rule never hides a failure already found, and a crashed daemon is unchanged; subagent exemption is sound when the main agent edited; older registration values without `head` read; the waiting entry returns at once under a stop mark.

Owns: only the review file. Do not run a full suite or `pnpm run build`; read affected results with `squeal status --wait 60000 <paths>`.

## R2: narrow re-review of cand/0.1.429

Use /reviewer, same reviewer (c35253da). Pinned to `cand/0.1.429` at `ba8cf4ec78cbab12c07f702a406b781c3a00cce4`. New since R1: the B1 repair `8985e9c9c` (cherry-picked from worker commit `5ed473458`) and its bundles; the rest was rebased onto docs-only main commits. Verify B1 closed (both harnesses, both entries, controls kept; the new cases fail without the fix), that the open-first order for a live or crashed daemon is unchanged, and nothing else regressed in the diff `d8bac243f..ba8cf4ec7` restricted to `src`, `test` and `plugins`. Write `reviews/0.1.429-r2.md`, PASS or FAIL, and commit it. Same host policy as R1.
