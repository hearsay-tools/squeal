# Wave 81: rows 011-323 and 011-325 (the shared rules reach every request; covered files recorded)

Coordinator 9ddca779, 2026-11-13. Row 011-322 landed as 0.1.470 (`tasks/wave-78.md`, review `reviews/0.1.470.md` PASS): every scheduler request goes through `RequestIntake.take` (`src/core/scheduler/request-intake.ts`, declarations typed in `request-intake-types.ts`). This wave runs 011-323 and 011-325 in parallel on split ownership. Row 011-324 follows in wave 82, after this wave and after row 011-326 (coordinator cdd216e5) lands, since both edit `src/cli/run-group.ts`.

Host policy, as in `wave-78.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

Shared files and the split: both rows edit `request-intake.ts`, `request-intake-types.ts` and `retries.ts`. W1 owns `WakeRule`, `NowRequest`, the intake's synchronous path (`#now` and `take`'s first overload), `observedRequest` and `retryRequest.wake`. W2 owns `Staged`, `StageRule`, the stage and record steps (`#stage`), the request id, and each declaration's stage and covered files. Touch the other's parts only to keep the build compiling, and say so in your notes.

## W1: row 011-323

Use /worker. Shape: slice, test first, one commit per step.

Outcome: an import's waiting mark is written inside the busy-store retry, and a `squeal retry` wakes the lanes of the files it queued if a test shows it must; the two named skips are gone.

Read: board row 011-323; `research/request-intake.md`, "The differences between request paths" 1 and 2; `tasks/011-322/notes.md`, "Requests" (import, retry) and "For the next rows"; spec 021 D2.

Seam and lead: `observedRequest` (`src/core/scheduler/imports-waiting.ts`) and its skip naming difference 1; its callers `daemon.ts:416` (lifecycle, reads the boolean at once, writes nothing) and `daemon.ts:1095` (`squeal import`, through `#requestRetries`). First edit: a failing test with a second connection holding `BEGIN IMMEDIATE` (`test/helpers/busy-store.ts`): `squeal import` into a running daemon re-keys once the holder ends, and status names the import meanwhile. Then the retry: a test first that shows whether a retried slow-lane file waits for the slow lane's next planning; only if it does, the retry wakes its files' lanes (`retryRequest.wake`).

Owns: `imports-waiting.ts`, `retries.ts` (`retryRequest.wake` only), the W1 parts of `request-intake.ts` and `request-intake-types.ts`, `scheduler.ts` (`refreshObserved`, `requestRetries`), the import and retry lines of `src/core/daemon/daemon.ts` (`:416` and `#requestRetries`; no other line), new tests for both cases.

Leave alone: the W2 parts above, `test/scheduler/request-intake.test.ts` beyond rows whose declaration you change, the bridge files (`types/daemon.ts`, `protocol.ts`, `handlers.ts`, `front-desk.ts`, `desk-messages.ts`, `desk.ts`, the `daemon.ts` guards), `slow-tier.ts`, `tiers.ts`, `focused.ts`, `slots.ts`, `#pump` and what it calls, keys, `KEY_FORMAT_VERSION`.

Stop and ask the coordinator if the lifecycle's boolean (`daemon.ts:416`) must become a promise, if a bridge file must change, or if the retry test shows no wait (then the skip stays with the test as its reason).

Done when: the row's done-when holds; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-323/notes.md`. Your final message lists decisions the design did not settle, type changes, and anything W2 must know.

## W2: row 011-325

Use /worker. Shape: slice, test first, one commit per step.

Outcome: each request's covered files are recorded as the scheduler decided them, keyed by a request id, in the transaction that queues them, and one reader under `src/core` returns them by id.

Read: board row 011-325; `research/request-intake.md`, "Covered files (011-325)" with its five conditions (agreed with card 3; coordinator cdd216e5's row 011-328 reads your record); `tasks/011-322/notes.md`, "For the next rows"; `reviews/0.1.470.md` S1 and N1; `research/waits.md` for how 011-328 will read it.

Seam and lead: `Staged.covered` and the intake's `#stage` (`request-intake.ts`), where the record is written inside the stage's transaction. First edit: the table, one row per request (`run --all`, `run <group>`, `run --slow`, `run <group> <path>`, `retry`): its covered files as decided (queued, already current, not queued with the reason), including a fast-lane request joined to a baseline (its own files only) and the install wait (not queued, with the reason). Fold S1 in: the fixture uses the real `RequestProgress`, not a log of `record` calls.

Owns: the W2 parts of `request-intake.ts` and `request-intake-types.ts`; the stages of `checkpoint-requests.ts`, `narrow-run.ts`, `request-intake-requests.ts`, `retries.ts` (`retryRequest`'s stage); a new store table and its reader (read `src/core/store/schema.ts` for schema steps); the optional id field on the `run-all`, `run-group` and `run-slow` answers in `src/core/types/daemon.ts` and where `src/core/daemon/run-group.ts` and `run-slow.ts` pass them; `test/scheduler/request-intake.test.ts`; the new tests.

Leave alone: the W1 parts, `src/cli/**` (card 3's row switches the CLI), the other bridge files, `slow-tier.ts`, `tiers.ts`, `focused.ts`, `slots.ts`, `#pump`, keys, `KEY_FORMAT_VERSION`.

Stop and ask the coordinator if an answer must carry more than the id, if the schema step breaks an older daemon sharing the store, or if a request's covered set differs from what it queues today.

Done when: the row's done-when holds; an older CLI that gets the id ignores it; the record survives a daemon handoff (a test); a record is pruned only after its files are no longer queued or running and 10 minutes have passed; lint and typecheck pass; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-325/notes.md`, naming the reader function for card 3. Your final message lists decisions the design did not settle, type changes, the schema step, and anything W1 must know.

## R1: review of cand/0.1.478

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.478` at `ee2d2827f40ad79248923037bfb917b6829f80b6`; range `96e9fad22..ee2d2827f`: eight commits of W2 (2498379c, row 011-325), three of W1 (ec4b104d, row 011-323), cherry-picked in that order; the coordinator's integration commit `8716240f9` (the import's record skip; a doc-comment conflict in `retries.ts` resolved by keeping both); then the 0.1.478 bundles. Read: board rows 011-323 and 011-325, `research/request-intake.md` (differences 1 and 2; "Covered files (011-325)" and its five conditions), `tasks/011-323/notes.md`, `tasks/011-325/notes.md`, this file's W1 and W2, `reviews/0.1.470.md`. Candidate CI: run 43523983653.

Check, each as proven, plausible or unverified:

1. 011-323: with a second connection holding the write lock, `squeal import` into a running daemon re-keys once the holder ends, and status names the import meanwhile (`test/shared/import-busy.test.ts`). `ImportsSeen.take` is now async: for each caller, before and after, can an import be taken twice, or lost after a `false` or a throw? The lifecycle refresh (`daemon.ts:416`) stays synchronous with its boolean unchanged.
2. 011-323: the retry test (`retry-slow-lane.test.ts`) shows the wait it claims, and `coveredLanes` wakes only the lanes of the files the retry queued. Judge W1's notes 6 and 7 (a window left in `slow-tier.ts`; a retried file in a `commit` or `manual` group stays queued): is either a regression against main, or only a remaining gap?
3. 011-325, the five conditions: the record is written in the same transaction as the queueing (a failed write rolls the queueing back); `readCoveredFiles` in `src/core/store/covered-files.ts` is the one reader; a record is kept while any file is queued or running and at least 10 minutes after; an answer without the id leaves the CLI on today's guess; the record survives a daemon handoff. The new table is created on first write with no schema step: an older daemon sharing the store opens it unchanged, and no key reads it.
4. 011-325, what changed for users: the answers gain only an optional `coveredId` (`run-all` beside `owner`, `requested.coveredId` for `run-slow` and `run-group`); every other answer field, CLI output and exit code is unchanged. The narrow run's install-wait answer now writes a record in a busy-retried transaction: say whether that can delay or fail a `squeal run <group> <path>` that answered at once before.
5. The integration: the two rows' edits to `request-intake.ts`, `request-intake-types.ts` and `retries.ts` combine as both workers meant; the import writes no record (its named skip) and its progress record is unchanged; review 0.1.470 S1 is closed by the probe's real `RequestProgress`.
6. `test/keys/key-format.test.ts` passes with no version raise; `git diff 96e9fad22..ee2d2827f -- src/core/scheduler/slow-tier.ts src/core/scheduler/tiers.ts src/core/scheduler/focused.ts src/core/scheduler/request-progress.ts src/cli` is empty.

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; affected results through `squeal status --wait 60000 <paths>`. Write `reviews/0.1.478.md` and commit it on your branch.
