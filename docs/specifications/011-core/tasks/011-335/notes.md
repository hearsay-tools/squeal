# Row 011-335 notes: group and narrow requests wait for a pass started after them

Worker 99f00902, 2026-11-14. Brief: `tasks/wave-82.md`, "W1, part 2: row 011-335", as written in `2f0d863d6` (a later docs commit, `f4f0390b4`, removed the section by accident; coordinator 9ddca779 confirmed the text and restored it on main at `747de4c7d`). Design: `research/group-wait-edits.md`, F1, F2 and the "In the daemon" placement the human chose.

## What changed

- `groupRequest` (`src/core/scheduler/request-intake-requests.ts`) and `narrowRequest` (`src/core/scheduler/narrow-run.ts`) get `start: { skip, afterPass: true }`, the start rule `fullSuiteRequest` has had since row 011-198. The intake (`RequestIntake.#afterPass`, unchanged) then reads the change feed's `started()` count, waits for `pass()`, and takes the request only when a pass numbered above that count was delivered; otherwise it throws `NO_PASS`.
- No other source file changed. `run --all`'s rule (`checkpoint-requests.ts`) is unchanged. No key reads either start rule: no key change, no `KEY_FORMAT_VERSION` change.
- Only a scheduler with the change feed's passes (`daemon-loop/index.ts`, the one place `passes` is set) waits. A scheduler without them (every `test/scheduler` fixture that builds one) takes the request as before: `#afterPass` returns at once when `passes()` is `undefined`.

## Who takes the pass now

`groupRequest` serves more than `squeal run <group>`. Each of these now waits for one reconciliation pass (0.06 to 0.23 s on a small tree at load in the research; at least `git status`'s time on a large one):

| Client | Through | Waits for the pass |
|---|---|---|
| `squeal run <group> [--wait]` | `requestGroup` | yes |
| `squeal run <group> <path>... [--wait]` | `requestGroupPaths` (`narrowRequest`) | yes |
| `squeal run --slow [--wait]` | `requestSlowSuite`, `groupRequest(SLOW_GROUP)` | yes |
| `squeal run <lint group>` (the release, row 019-22) | `groupRequest`'s outside release | yes, before the release |
| Stop's waiting entry for a required group (`stop-wait.ts` `requestGroups`) | `run-slow` / `run-group`, not awaited | yes; it sends and does not wait for the answer |

While an install is awaited, the pass comes first, then the install-wait answer (row 011-324's reason). A pass that finds the install ends the wait, so the request is then staged as usual: the same order `run --all` has.

## When no pass is delivered (`NO_PASS`)

The pass failed, or the daemon closed first. The request then fails with `NO_PASS`, as `run --all` does. Measured with the CLI against a fake daemon that answers each request with `error: NO_PASS` (a throwaway test, deleted; this commit's CLI files):

| Command | Without `--wait` | With `--wait 3000` |
|---|---|---|
| `squeal run --all` | exit 1, stderr `squeal: run --all failed: <NO_PASS>` | exit 3, stdout `No verdict: run --all failed: <NO_PASS>` |
| `squeal run tests` | exit 1, stderr `squeal: squeal run <group> failed: <NO_PASS>` | exit 3, stdout `No verdict: squeal run <group> failed: <NO_PASS>` |
| `squeal run tests test/a.test.ts` | exit 1, the same stderr line | exit 3, the same stdout line |
| `squeal run --slow` | exit 1, stderr `squeal: run --slow failed: <NO_PASS>` | **exit 1**, the same stderr line |
| `squeal run <lint group>` | read in source, not run: `run-lint-group.ts` prints `squeal run <group> failed: <NO_PASS>` through the same `noVerdict` (exit 1, or 3 with `--wait`) | |

`<NO_PASS>` is: "the change feed delivered no reconciliation pass that started after the request (its pass failed, or the daemon closed first), so no checkpoint was planned".

No CLI file has to change for the codes: `run <group>` and the narrow run already end like `run --all` (1, or 3 with `--wait`). Three wording points for the run CLI's owner (coordinator cdd216e5), none changed here:

1. `NO_PASS` ends "so no checkpoint was planned"; a group, narrow or slow request plans no checkpoint. The constant lives in `src/core/scheduler/request-intake.ts`, outside this row's ownership. A neutral ending ("so the request was not taken") would fit all four.
2. `run <group>` prints the literal `squeal run <group> failed`, not the group's name (`runFailed` in `src/cli/run-group.ts`, `failed` in `run-lint-group.ts`); this was already so for every failure.
3. `run --slow --wait` exits 1, not 3, on a failed request; this was already so for every failure (`run-slow.ts` `taken`).

## Tests

- `test/scheduler/request-intake-group.test.ts`, "the group and narrow requests wait for a pass (row 011-335)": the probe's order as two intake rows. `C` is current; the pass the request waits for stores an edit that moves `C`'s key; the answer is at the edit's revision and `C` is queued. Red before the change (answer at revision 0). Two more rows: with no pass delivered after the request, both reject with `NO_PASS` and take nothing.
- `test/scheduler/request-intake-probe.ts`: the probe's state gains `stores`, what the next pass stores (`null`: nothing). Existing rows set none and behave as before.
- `test/cli/run-group-daemon.test.ts`, "takes the group's and the narrow run's request at the edit's revision, and gives its verdict": the research probe's in-process order on a real daemon. A Stop group's file is current (a warm `run e2e --wait`); after the revision is still for 1.5 s, an edit, then at once `runGroupCommand` in this process: `run e2e --wait` must exit 1 for a failing edit and `run e2e test/e2e/value.test.ts --wait` exit 0 for the passing edit after it, each taken at a revision above the one before the edit. Red before the change: `Group e2e completed at revision 0: no known failures`, exit 0 for the failing edit.

## Existing expectations changed

- `test/scheduler/request-intake.test.ts`, "records the real group request's files: a running one counts once it ended": the log now starts with `pass` (the probe's host has passes).
- `test/scheduler/request-intake-group.test.ts`, row 011-324's "names the reason ..." rows (this wave's own test): the log is `["pass", "pump"]` instead of `["pump"]`.

No other test took a group, narrow or slow request before any pass: the scheduler fixtures set no `passes`, and the real-daemon tests read the answer, not its timing. Checked through Squeal at revision 12 to 16: `test/daemon/run-group.test.ts`, `run-group-paths.test.ts`, `run-group-holder.test.ts`, `run-slow.test.ts`, `nudge.test.ts`, `desk-guard.test.ts`, `install-wait.test.ts`, `test/harness/stop-slow-scheduler.test.ts`, `test/integration/status-wait-edit.test.ts`, `test/lint/wiring/stop-group.test.ts`, and in `test/cli`: `run-group*.test.ts`, `run-lint-group.test.ts`, `run-slow*.test.ts`, `slow-wait-liveness.test.ts`, `status-wait-group-readers.test.ts`, `group-pending-release.test.ts`: all pass. `test/e2e/run-triggers.test.ts` sends `run e2e --wait` too; Squeal excludes `test/e2e/**` and it drives the shipped plugins, so it was not run here (CI runs it).

## Decisions the design did not settle

1. **The lint group's release waits for the pass too.** It is the same request (`groupRequest`), and the row asks for one rule for every client. Its outside release runs after the pass, so the lint pass it nudges starts from the edit's revision.
2. **No test pins the `NO_PASS` CLI wording.** The three wording points above belong to the CLI's owner; a test here would pin text another row may change.
