# Row 011-324 notes: `squeal run <group>` names the install wait

Worker 99f00902, 2026-11-14. Brief: `tasks/wave-82.md`, W1 (with part 2, row 011-335, from `2f0d863d6`). Design: `research/request-intake.md`, difference 3.

## What changed

- **The reason reaches the group's answer.** `InstallWaitRule.stage` (`src/core/scheduler/request-intake-types.ts`) gets a fourth parameter, `reason: string`, the reason the intake already holds (`IntakeHost.waiting()`); `RequestIntake.#stage` passes it. The `answer` variant (the narrow run's) already had it. Every other install-wait stage takes three parameters and compiles unchanged. Agreed by coordinator 9ddca779 (option a of the worker question, 2026-11-14).
- **`groupRequest`'s install-wait answer** (`request-intake-requests.ts`) sets `installWait: reason` beside `queued: 0`. Only that answer sets it: the stage and the lint release never do.
- **The daemon copies it** into `RunGroupResponse.requested` (`src/core/daemon/run-group.ts`, `groupRequests`'s `answer`), as it copies `coveredId`. `run-slow`'s answer passes the scheduler's object through (`handlers.ts` `runSlow`), so it carries the field with no change.
- **`requestedText`** (`src/cli/run-group.ts`, that function only) prints `No test files of group <name> run at revision <n>: <reason>.` when the field is set, before the `queued === 0` sentence. With `--wait`, `waitForGroup` prints the same line after the verdict line (it is the wait's `line`).

## Type changes (additive)

- `InstallWaitRule.stage`: fourth parameter `reason: string`.
- `SlowSuiteRequest.installWait?: string` (`src/core/types/scheduler.ts`): the scheduler's answer type of `requestGroup` and `requestSlowSuite`.
- `RequestTaken.installWait?: string` (`src/core/types/daemon.ts`): the wire field in `run-group` and `run-slow` answers. An older daemon sends none (the CLI prints today's sentences); an older CLI ignores it (it reads `revision` and `queued` only).

## Exit codes

Unchanged by construction: `requestedText` returns a string, and the code paths around it do not read the field. Measured against a real daemon awaiting an install (`test/daemon/install-wait.test.ts`): `squeal run tests` exits 0, `squeal run tests --wait 3000` exits 3 (the group has no listed test files, so no verdict), each with the reason line.

## Tests

- `test/daemon/install-wait.test.ts`, "squeal run <group> names the install it waits for, with and without --wait": a real daemon in a worktree with no install, the built CLI. Red before the change (the receipt was "... the group has none or all are current."), green after.
- `test/scheduler/request-intake-group.test.ts` (new): the real group request through the intake's probe; both reasons (`AWAITING_INSTALL_REASON`, `REINSTALLED_REASON`) in the exact answer, nothing woken; the `slow` group too; a group the policy lacks still answers `null`; no field once no install is awaited.
- `test/cli/run-group.test.ts`: the receipt for both reasons, exit 0; `run --slow` prints and exits the same with and without the field (a CLI that does not read it).

## Decisions the design did not settle

1. **Field name `installWait`**, after the intake's rule name ("install-wait answer"); its value is the reason clause, not a code. A CLI prints it as it comes.
2. **Wording.** `No test files of group <name> run at revision <n>: <reason>.` keeps the opening of the sentence it replaces and ends with the narrow run's reason clause. It names no install command (the status header and the `--wait` deadline line do) and promises no later run: after the install, the group's files run at their moment, not because of this request.
3. **A lint group** waiting for an install also gets the field (the release is skipped while `waiting()` is set, so the stage path answers). `runLintGroupCommand` does not read it; its text is unchanged.

## For the next worker or the run CLI's owner

- `squeal run --slow` still prints "No slow files to run at revision N: none are declared in squeal.config.json or all are current." while an install is awaited: the false sentence this row removed from `run <group>`. Its answer now carries `requested.installWait`; `src/cli/run-slow.ts` (coordinator cdd216e5's CLI files) can print it the same way. Not changed here (the brief left `run --slow`'s text alone).
