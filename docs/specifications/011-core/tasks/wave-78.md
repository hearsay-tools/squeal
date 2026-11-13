# Wave 78: row 011-322 (one request intake, behaviour preserved)

Coordinator 9ddca779, 2026-11-13. The human approved rows 011-322 to 011-325 ("Approve, land, start"; design session b3f9b586). This wave is 011-322 alone. Rows 011-323, 011-324 and 011-325 follow, briefed from this row's intake. Spec 011's waits rows 011-326 to 011-328 run under coordinator cdd216e5.

Host policy, as in `wave-76.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-322

Use /worker. Shape: slice, test first, one commit per step.

Outcome: every request the scheduler takes goes through one intake that applies the shared rules in one fixed order; no answer, response type, CLI output, key or store format changes.

Read: board row 011-322; `research/request-intake.md`, all of it (its "Coordinator's calls" are your contract); `GLOSSARY.md`, "Requests"; spec 021 D2; `reviews/0.1.452.md` B1 and B2 (the last move of this shape failed review on a test path parallel to the real one, and on a case the move left out).

Seam and lead: `Scheduler.requestFullSuite` to `refreshObserved` (`src/core/scheduler/scheduler.ts:639-910`), `#transact` and `#request` (1373-1406). First edit: the intake's types and its table test, `test/scheduler/request-intake.test.ts`: a probe request through the same entry point the scheduler calls, a real store and ledger, a second connection holding `BEGIN IMMEDIATE` (`test/helpers/busy-store.ts`), and `@ts-expect-error` cases for a declaration without its install-wait answer or its covered files. Then:

1. The intake, `src/core/scheduler/request-intake.ts` (the entry; more files beside it if needed; no barrel). `#transact` and `#request` move in.
2. Move one request per commit: retry (`#takeRetries`' record callback becomes required), promote and focus, import, group (its lint branch a named skip), narrow run, `run --all` last.
3. Delete the cases the table replaces; map each to its table row in your notes. `request-progress.test.ts:121` (wave-3.6 B1) stays.

Before you move a request, list in your notes every path through its method today (each early return, `null`, throw, lock and busy-retry boundary) and the quirk you keep. The design names five quirks; all hold. If the fixed order cannot hold one without a change, stop and ask.

Owns: `scheduler.ts` (the request methods, `#transact`, `#request`, `#takeRetries` and its start and pass call sites), the intake files, `checkpoint-requests.ts`, `narrow-run.ts`, `retries.ts`, `imports-waiting.ts`, the new test, `test/scheduler/busy-requests.test.ts`, `test/scheduler/request-progress.test.ts`.

Leave alone: `slow-tier.ts`, `tiers.ts`, `focused.ts`, `slots.ts`, `revision.ts`, `omitted-test-files.ts` (card 8 and the later scheduler cards; put the group request's declaration in the intake's files, not beside `queueGroup`), `commit-moment.ts`, `#pump` and what it calls, `request-progress.ts`, `src/core/daemon/**`, `src/cli/**`, `src/core/types/**`, every key computation, `KEY_FORMAT_VERSION`.

Stop and ask the coordinator if a response type, an answer, a daemon file or a pump file must change.

Done when: the row's done-when holds; `git diff <base> -- src/core/daemon src/cli src/core/types` is empty; the tests the design's "stay" list names pass unchanged; `test/keys/key-format.test.ts` passes with no version raise; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-322/notes.md`: per request, its paths and kept quirks; each deleted case and its table row; the tests the table repeats and keeps. Your final message lists decisions the design did not settle, type changes, and any of the design's calls that did not hold.
