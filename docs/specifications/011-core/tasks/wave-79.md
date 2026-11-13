# Wave 79: row 011-326 (one wait module for the run waits, behaviour preserved)

Coordinator cdd216e5, 2026-11-13. The human approved rows 011-326 to 011-328 ("Approve, land, start"; design session c86019be, architecture review card 3). This wave is 011-326 alone. 011-327 follows after 011-326 lands; 011-328 after 011-326 and card 2's row 011-325. Wave 78 is coordinator 9ddca779's row 011-322 (`src/core/scheduler/` only).

Host policy, as in `wave-76.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no probe or harness session under the real `HOME`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-326

Use /worker. Shape: slice, test first, one commit per step.

Outcome: `run --all --wait`, `run <group> [<path>] --wait` (test and lint) and the four request loops take their polling, deadline, store read, daemon check and outcome from one module; no outcome, printed line, JSON payload or exit code changes.

Read: board row 011-326; `research/waits.md` (all of it; the coordinator's calls are your contract); `GLOSSARY.md`, "Waits", "Requests", "Daemon" (use its terms in names); spec 005 D1; spec 019 D6.

Seam and lead: the three run waits are `ended`/`pollCheckpoint` (`src/cli/run.ts:333`), `ended`/`pollGroup` (`run-group-wait.ts:226`) and `linted` (`run-lint-group.ts:147`); the request loops are `recorded` (`run.ts:221`), `taken` (`run-slow.ts:88`), `takenRequest` (`run-group.ts:157`) and `taken` (`run-lint-group.ts:81`). First edit: the module's types and the pure rows of its table test under `test/cli/wait/`: one read record in, "go on" or "end with this outcome and reason" out, one row per outcome of each run wait. Then:

1. `src/cli/wait/`, one entry file, no barrel: the rule table, the pure decision, the polling loop with clock and socket ports, and one file for the progress reads (checkpoint end and progress, latest revision, install wait and its command) through today's parsers (card 4's seam). The files a wait is for are an input: a lane, a group or a list.
2. The commands call the entry with plain data and render its outcome union as today. One entry serves the four request loops; each keeps its response type and wording.
3. Loop rows over a scratch store, the existing fake daemon socket and a stepped clock: the deadline's last read and each request loop.
4. Delete the decision cases the table replaces (the record's list); keep the record's "Stay" list passing unchanged.

Rules the last two moves of this kind failed review on:

- **Reads stay as they are** (review `0.1.403.md` B2). Each wait reads only what it reads today, in today's order, with today's store busy timeout, comparisons (`>=` and `>`), pauses and ping cadence. A record field a wait's row does not use is not read for that wait.
- **One decision path** (review `0.1.452.md` B1). The table test calls the decision the commands call, never a copy.
- **Accidental differences are cell values**, named in the table: the unbounded `askDaemon` in `run.ts` and `run-slow.ts` against `askWithin`; a store that does not open read as "stopped"; a busy store that throws; the lint group's `deadline` without a verdict; the six outcome orders. 011-327 changes them, not you.

Owns: `src/cli/wait/**`, `test/cli/wait/**`, `run.ts`, `run-slow.ts`, `run-group.ts` (not `requestedText`), `run-group-wait.ts`, `run-lint-group.ts`, `run-lanes.ts`; imports only in `run-group-narrow.ts` and `group-pending.ts`; the cases the row deletes from `test/cli/run-*.test.ts`.

Leave alone: `src/core/**` (`src/core/scheduler/` is row 011-322's; `src/core/presence/` is daemon presence's); `status-wait*.ts`, `status-paths.ts`, `verdict.ts` beyond an import; `wait-liveness.ts`; `daemon-access.ts`; `src/cli/code*.ts`; `run-group.ts` `requestedText` (row 011-324); `run --slow --wait`'s file wait in `waitForStatus`; `KEY_FORMAT_VERSION`.

If some behaviour cannot be kept, keep today's and name the case in your notes; ask the coordinator if a `src/core` file must change.

Done when: the row's done-when holds; `grep -n "sleep(\|for (;;)" src/cli/run*.ts` finds no wait loop; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; the record's "Stay" tests pass unchanged; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-326/notes.md`: the table, each deleted case mapped to its table row, each accidental difference and its cell. Your final message lists decisions the record did not settle, type changes, and any call of the record that did not hold.
