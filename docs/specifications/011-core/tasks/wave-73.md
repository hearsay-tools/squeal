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
