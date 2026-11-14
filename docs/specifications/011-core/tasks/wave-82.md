# Wave 82: rows 011-324 (`squeal run <group>` names the install wait) and 011-335 (a group request waits for the edits made before it)

Coordinator 9ddca779, 2026-11-14. Rows 011-322 (0.1.470), 011-323 and 011-325 (0.1.478) landed; every scheduler request goes through `RequestIntake.take`. This wave is 011-324, then 011-335 (the human's decision "In the daemon", 2026-11-14, on row 011-332's reproduction `research/group-wait-edits.md`; numbered by coordinator cdd216e5, taken in this lane because both rows change `groupRequest`). One worker, one commit series per row, one candidate. Coordinator cdd216e5's row 011-328 (wave 86) edits `src/cli/run-group.ts` except `requestedText`, and other run CLI files; whichever lands second rebases.

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

## W1, part 2: row 011-335

After 011-324's commits, in the same worktree. Test first.

Outcome: a `run <group>` or `run <group> <path>` request is taken only after a reconciliation pass that started after it was delivered, as `run --all` is (row 011-198), so a verdict includes an edit stored just before the request.

Read: `research/group-wait-edits.md` (F1, the decision options, the probe in `research/probes/group-wait-edits/`); board row 011-335; `checkpoint-requests.ts` `fullSuiteRequest`'s `start: { skip, afterPass: true }` and the intake's `#afterPass`.

Seam and lead: `groupRequest`'s start rule (`request-intake-requests.ts`, about line 98) and `narrowRequest`'s (`narrow-run.ts`, about line 118), both a plain skip today. First edit: a failing test in the probe's in-process order: an edit, then the request at once, the file current before the edit; the answer and the verdict must be at the edit's revision.

Report in your notes: `groupRequest` also serves `run --slow` (`requestSlowSuite`) and a lint group's release, so they wait for a pass too; when the pass fails or the daemon closes first, each answers `NO_PASS`: say what `squeal run <group>`, `squeal run <group> <path>` and `squeal run --slow` print and exit with then, against `run --all`, and whether a CLI file must change (ask before changing one).

Owns: the start rules of `groupRequest` and `narrowRequest`, their tests, the expectations of existing tests that took a request before any pass (name each in the notes).

Done when: the row's done-when holds; the probe's in-process order gives the edit's revision; lint and typecheck pass; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-335/notes.md`.

## R1: review of cand/0.1.481

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.481` at `e0b32db36e9ee4103367f5c7b92ea9f9a1c7f931`; range `a6225adda..e0b32db36`: three commits of worker 99f00902 (row 011-324 `a91ad9468`, row 011-335 `a757af2b1`, notes `ca7297f4a`), cherry-picked, then the 0.1.481 bundles. Read: board rows 011-324 and 011-335, `research/request-intake.md` (difference 3), `research/group-wait-edits.md`, `tasks/011-324/notes.md`, `tasks/011-335/notes.md`, this file's W1 and part 2. Candidate CI: run 43586106691.

Check, each as proven, plausible or unverified:

1. 011-324: while no dependencies are installed, and after a reinstall, `squeal run <group>` prints the reason and not "the group has none or all are current"; exit codes are unchanged with and without `--wait`; the new optional `installWait` on `RequestTaken` and `SlowSuiteRequest` is set only by the install-wait answer; an older CLI that ignores it prints and exits as before. The intake change is one added `reason` parameter of `InstallWaitRule.stage` and one argument in `#stage`: nothing else in the intake moved.
2. 011-335: `groupRequest` and `narrowRequest` are taken only after a reconciliation pass that started after the request was delivered, as `run --all` is (row 011-198); the research probe's in-process order (an edit, then at once the request, the file current before the edit) now gives the edit's revision. Who else now waits for a pass: `run --slow`, a lint group's release, Stop's waiting entry (the notes). Say whether any of them can now wait where a user did not before, how long at most, and whether a `NO_PASS` there is reachable in normal use (a daemon that closes, a pass that fails).
3. The notes' `NO_PASS` table (exit codes per command): the CLI files are unchanged; judge whether any exit code or message a user meets is now wrong, as opposed to worded loosely (the wording points went to coordinator cdd216e5, who owns those files).
4. No key change: `test/keys/key-format.test.ts` passes with no version raise; `git diff a6225adda..e0b32db36 -- src/cli` touches only `requestedText` in `src/cli/run-group.ts`.

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, a small `--maxWorkers` and a longer `--hookTimeout`; record any load timeout with its retry. Write `reviews/0.1.481.md` and commit it on your branch.
