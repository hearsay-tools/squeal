# Wave 82: row 011-324 (`squeal run <group>` names the install wait)

Coordinator 9ddca779, 2026-11-14. Rows 011-322 (0.1.470), 011-323 and 011-325 (0.1.478) landed; every scheduler request goes through `RequestIntake.take`. This wave is 011-324 alone. Coordinator cdd216e5's row 011-328 (wave 86) edits `src/cli/run-group.ts` except `requestedText`, and other run CLI files; whichever lands second rebases.

Host policy, as in `wave-81.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; a failure only on timing is load: `squeal retry <file> --reason load`, never past a real one. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-324

Use /worker. Shape: slice, test first.

Outcome: while no dependencies are installed (or after a reinstall), `squeal run <group>` prints the install-wait reason instead of "the group has none or all are current"; its exit code is unchanged.

Read: board row 011-324; `research/request-intake.md`, difference 3; `GLOSSARY.md`, "Requests".

Seam and lead: `groupRequest`'s `installWait.stage` (`src/core/scheduler/request-intake-requests.ts`, about line 105) answers `{ revision, queued: 0, coveredId }` with no reason; the narrow run already says `AWAITING_INSTALL_REASON` or `REINSTALLED_REASON` (`src/core/scheduler/install.ts`). `requestedText` (`src/cli/run-group.ts`, about line 122) prints the false sentence for `queued === 0`. First edit: a failing CLI test that runs `squeal run <group>` against a daemon awaiting an install and expects the reason in the receipt and the same exit code, with and without `--wait`.

Then: one optional field on `RequestTaken` (`src/core/types/daemon.ts`) carrying the reason (an older CLI ignores it; a test shows it), set by the group's install-wait answer only; `requestedText` prints it.

Owns: `request-intake-requests.ts` (`groupRequest`'s install-wait answer), `RequestTaken` in `src/core/types/daemon.ts`, the copy into `requested` in `src/core/daemon/run-group.ts` if needed, `requestedText` in `src/cli/run-group.ts` (that function only), new tests and the expectations an exact answer comparison needs.

Leave alone: the rest of `src/cli/run-group.ts` and every other `src/cli` file (row 011-328), `run --slow`'s CLI text (it may receive the field and ignore it), `src/core/scheduler/request-intake.ts` and its types unless the reason cannot reach the answer otherwise (then ask), keys, `KEY_FORMAT_VERSION`.

Stop and ask the coordinator if the reason needs a change to the intake's types, to `run --slow`'s output, or to an exit code.

Done when: the row's done-when holds; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-324/notes.md`. Your final message lists decisions the design did not settle, type changes, and the commits.
