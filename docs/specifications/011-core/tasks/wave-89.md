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

## R1: review of cand/0.1.486

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43597872117. Pinned to `cand/0.1.486` at `214d1f0f249004486b8aaf13551e03899b627ef6`; range `5f7998206..214d1f0f2`: six commits of worker e3df2f70, cherry-picked (`063ded510` tests pinned to today's output, `b62421e2c` the intake, `8f1259b4f` the CLI, three notes commits), then the 0.1.486 version raise and bundles. Behaviour to compare against: `5f7998206`. Read: board row 011-337, `tasks/011-337/notes.md`, this file's W1.

Check, each as proven, plausible or unverified:

1. **`run --all` is unchanged byte for byte**: its refusal still ends "so no checkpoint was planned", and its exit codes are as before.
2. **Each other request words its own refusal** (group, narrow, slow, lint), with no word of a checkpoint; the words come from each request's start rule in the intake (`afterPass`), with no switch on kind; nothing else in the intake changed.
3. **The CLI changes are exactly the row's**: `run <group>` and the lint group name the group in a failed request; `run --slow --wait` exits 3 on a refused pass and keeps exit 1 without `--wait`; `run --slow` prints the answer's `installWait`; no other line or exit code changed.
4. **Replace, don't layer**: the rows pinned to today's output were flipped, the 011-324 pin "run --slow ignores the install wait" retired as the notes say.
5. **Scope**: in `src/core/` only the intake lines 9ddca779 granted (the `NO_PASS` constant and its throw, the `afterPass` variant, the start rules of `groupRequest`, `narrowRequest`, `fullSuiteRequest`); no key change (`test/keys/key-format.test.ts` passes with no raise).

The coordinator's tree passed lint, typecheck, `check:version`, `run-refused-pass`, `request-intake`, `request-intake-group`, `run-group`, `key-format` and `version-sensitive` (80 tests) and the bundle tests at the candidate. Host policy as in `wave-85.md`. Write `reviews/0.1.486.md` and commit it on your branch.
