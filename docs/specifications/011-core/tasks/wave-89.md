# Wave 89: row 011-337 (the run commands word a refused pass and an install wait for the request they made)

Coordinator cdd216e5, 2026-11-14. The human approved the row on 2026-11-14 ("Approve the row"), from coordinator 9ddca779's findings while building row 011-335 (0.1.481, on main): group, narrow, slow and lint requests now wait for a reconciliation pass and can be refused with `NO_PASS`, as `run --all` is. Row 011-331 (worker e28cc221) works in `src/cli/wait/` at the same time: whichever lands second rebases.

Host policy, as in `wave-85.md`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-337

Use /worker. Shape: repair, test first.

Outcome: when the daemon refuses a request for want of a pass, each command says so for the request it made, with no word of a checkpoint unless it asked for one; `run <group>` names its group; `run --slow --wait` exits 3 on that refusal as the other waits do; `run --slow` names the install wait its answer carries.

Read: board row 011-337; `research/request-intake.md` (row 011-198's `afterPass` rule); `tasks/011-327/notes.md`, the request loops; GLOSSARY "Requests".

Changes:
1. **The refusal text, in the intake** (agreed with coordinator 9ddca779, 2026-11-14). `NO_PASS` in `src/core/scheduler/request-intake.ts` ends "so no checkpoint was planned" for every request. Let each declaration name its refusal (9ddca779's preference: the `afterPass` start rule carries the text or derives it from the declaration's `operation`, so the intake has no switch on kind). `run --all` keeps today's text byte for byte. You may edit only: the `NO_PASS` constant and its throw in `#afterPass`, the `afterPass` variant in `request-intake-types.ts`, the start rules of `groupRequest`, `narrowRequest` and `fullSuiteRequest`, and their rows in `test/scheduler/request-intake*.test.ts`.
2. **The group's name.** `run-group.ts:200` and `run-lint-group.ts:109` print the literal "squeal run <group> failed"; print the group's name.
3. **`run --slow --wait`** exits 3 on a refused pass, as `run --all --wait` and `run <group> --wait` do; without `--wait` it keeps exit 1.
4. **`run --slow` and the install wait.** It prints "none are declared … or all are current" while dependencies are awaited; its answer now carries the reason (`requested.installWait`, row 011-324): print it, as `run-group.ts` `requestedText` does.

First edit: one command row each, pinned to today's output (a fake daemon answering `NO_PASS` for group, narrow, slow and lint; a slow answer with `installWait`); then flip them.

Owns: the intake lines above; `run-slow.ts`; `run-group.ts` except `requestedText`; `run-group-narrow.ts`; `run-lint-group.ts`; the files of `src/cli/wait/` the request loops need; the tests of these.

Leave alone: every other `src/core` line; `status-wait*.ts`, `status-paths.ts`; `src/cli/code*.ts`; `KEY_FORMAT_VERSION`.

Done when: the four changes hold with one command row each; no other line or exit code changes; lint and typecheck pass; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-337/notes.md` with each new line, so the coordinator can amend spec 005 D1 and spec 019 D6.
