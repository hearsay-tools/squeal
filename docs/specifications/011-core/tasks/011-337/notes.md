# Row 011-337 notes: the run commands word a refused pass and an install wait for the request they made

Worker e3df2f70, 2026-11-14. Brief: `tasks/wave-89.md`, W1. Shape: repair, test first. Commits on `cez/e3df2f70`: `edb41f18e` (the rows pinned to the output before the row), `5e0084764` (the intake), `1af0d8df4` (the commands).

## What changed

1. **The refusal text, in the intake** (agreed with coordinator 9ddca779, 2026-11-14). `NO_PASS` (`src/core/scheduler/request-intake.ts`) is now the refusal's head only: "the change feed delivered no reconciliation pass that started after the request (its pass failed, or the daemon closed first)". The `afterPass` start rule (`request-intake-types.ts`) carries a string instead of `true`: what was not done for that request. `#afterPass` throws `${NO_PASS}, so ${afterPass}`. The intake has no switch on the request's kind.
2. **The group's name.** `runFailed` in `run-group.ts` and `failed` in `run-lint-group.ts` print `squeal run <name> failed: ...`. `takenRequest` takes the group's name as its fourth parameter (before `unsupported`); `run-group.ts` and `run-group-narrow.ts` pass it.
3. **`run --slow --wait` exits 3 on a refused pass.** `run-slow.ts` `taken` returns `{ refused }` when the request's error starts with `NO_PASS`; the command words it as its busy-daemon case already did: with `--wait`, stdout `No verdict: run --slow failed: <error>`, exit 3; without, stderr `squeal: run --slow failed: <error>`, exit 1 (as before). The two cases now share one `noVerdict`.
4. **`run --slow` and the install wait.** `requestedText` in `run-slow.ts`: an answer with `installWait` prints `No slow files run at revision <n>: <reason>.`, as `run <group>` prints `No test files of group <name> run at revision <n>: <reason>.` (row 011-324). Queued and none-queued lines are unchanged. With `--wait` the status wait that follows is unchanged.

No other line or exit code changed. No key reads a start rule: no key change, no `KEY_FORMAT_VERSION` change.

## The new lines

`<PASS>` is the head above.

| Request | The intake's error |
|---|---|
| `run --all` | `<PASS>, so no checkpoint was planned` (unchanged, byte for byte) |
| `run <group>` | `<PASS>, so nothing was queued for group <group>` |
| `run <group> <path>...` | `<PASS>, so no test file of group <group> that the paths select was queued` |
| `run --slow` | `<PASS>, so nothing was queued for group slow` |
| `run <lint group>` | `<PASS>, so nothing was queued for group <group>` (the same `groupRequest`) |

| Command | Without `--wait` | With `--wait <ms>` |
|---|---|---|
| `squeal run unit` | exit 1, stderr `squeal: squeal run unit failed: <error>` | exit 3, stdout `No verdict: squeal run unit failed: <error>` |
| `squeal run unit <path>` | exit 1, stderr `squeal: squeal run unit failed: <error>` | exit 3, stdout `No verdict: squeal run unit failed: <error>` |
| `squeal run lint` (a lint group) | exit 1, stderr `squeal: squeal run lint failed: <error>` | exit 3, stdout `Group lint has no verdict: squeal run lint failed: <error>` |
| `squeal run --slow` | exit 1, stderr `squeal: run --slow failed: <error>` (unchanged) | **exit 3**, stdout `No verdict: run --slow failed: <error>` (was exit 1, the stderr line) |
| `squeal run --slow`, answer with `installWait` | exit 0, stdout `No slow files run at revision <n>: <reason>.` (was "No slow files to run at revision <n>: none are declared in squeal.config.json or all are current.") | the same line, then the status wait as before |

The `squeal run <name> failed` prefix applies to every failed `run-group` request of these commands, not only a refused pass (it was the literal `<group>` for all of them).

For spec 005 D1: `run --slow --wait` now exits 3 on a refused pass, as `run --all --wait` and `run <group> --wait` do. For spec 019 D6: `run <group>` names the group in a failed request; `run --slow` names the install wait.

## Tests

- `test/cli/run-refused-pass.test.ts` (new): one command row each against a stand-in daemon, without and with `--wait`: `run unit`, `run unit test/a.test.ts`, `run lint`, `run --slow`. Pinned first to the output before the row (`edb41f18e`, green on the code before), then flipped. Two guard rows for change 3: a daemon from before the row (its words end "so no checkpoint was planned") still gives exit 3, since the CLI matches `NO_PASS`'s head; another failure ("squeal scheduler: not started") keeps exit 1. Two rows for change 4, one per install-wait reason.
- `test/scheduler/request-intake-group.test.ts`, "each request words its refused pass (row 011-337)": one intake row per request (`run --all`, `run <group>`, the narrow run, `run --slow`, a lint group), each with its exact error against a literal head, not the constant. It replaces 011-335's "no pass delivered after it rejects with NO_PASS" rows, which matched a substring only.
- `test/scheduler/request-intake.test.ts`: the probe's two `afterPass` rows give a string; the refusal row checks the exact error.

### Retired

- `test/cli/run-group.test.ts`, row 011-324's "run --slow ignores the install wait in its answer": it pinned the behaviour change 4 reverses. The install-wait rows in `run-refused-pass.test.ts` replace it.

## Checks run

- `pnpm run lint`: clean (3391 files). `pnpm run typecheck`: clean.
- `squeal status --wait 60000` on `test/cli/run-refused-pass.test.ts`, `test/scheduler/request-intake.test.ts`, `test/scheduler/request-intake-group.test.ts`, `test/cli/run-group.test.ts`, `test/cli/run-group-narrow.test.ts`, `test/cli/run-lint-group.test.ts`, `test/cli/run-slow.test.ts`, `test/keys/key-format.test.ts`, `test/version-sensitive.test.ts`, `test/scheduler/full-suite-pass.test.ts`: all ten current and passing at revision 13.
- The run and intake tests nearest the change, all current and passing at revision 14: `test/cli/run-group-daemon.test.ts`, `run-slow-wait.test.ts`, `slow-wait-liveness.test.ts`, `run-slow-accept.test.ts`, `run-all-verdict-daemon.test.ts`, `run-all-verdict.test.ts`, `group-pending-release.test.ts`, `run-group-stall.test.ts`, `run-group-wait.test.ts`; `test/daemon/run-group.test.ts`, `run-group-paths.test.ts`, `run-slow.test.ts`, `install-wait.test.ts`; `test/scheduler/full-suite-pass.test.ts`.
- The affected set at revision 14 (`47a5cd205`, the test files that read the changed source files): 601 test files. 511 current at the last read (about 13:40 Europe/Warsaw); no known failure among them except 4, which are expected bundle drift: `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` each find the committed `cli/squeal.mjs` differs from the build. The bundles are the coordinator's (`plugins/*/dist`); this row did not run `pnpm run build`. Those 4 are queued again too.
- `test/daemon/step-down-lanes.test.ts` failed once under host load (its daemon refused a backlog tier at 18.3 to 20.3 busy CPUs, ceiling 18); its load retry (`squeal retry --reason load`) passed.
- Not waited for, on the coordinator's word (CI covers them): 90 test files still queued behind host load at revision 14, with no result at these inputs:
90 0
- `test/cli/` (4): code-gate-keep.test.ts, status-wait.test.ts, wait-reads.test.ts, warmup.test.ts
- `test/daemon/` (25): busy-edit.test.ts, busy-store.test.ts, busy-tier.test.ts, busy-writes.test.ts, departure.test.ts, died.test.ts, drain-wait.test.ts, drain.test.ts, handover-tier.test.ts, handover.test.ts, hardening.test.ts, hold.test.ts, last-use-daemon.test.ts, lifecycle.test.ts, reload-coverage.test.ts, restart-handover-signal.test.ts, resumed-after-signal.test.ts, runtime-gone.test.ts, serving.test.ts, shared-store.test.ts, start-handoff.test.ts, step-down.test.ts, stop-cancel.test.ts, unused-stop.test.ts, vacant-wait.test.ts
- `test/harness/codex/` (2): packaging/runtime.test.ts, version-copies-loop.test.ts
- `test/harness/` (8): opencode-continued.test.ts, opencode-dispose.test.ts, opencode-hooks.test.ts, opencode-wake.test.ts, opencode/package.test.ts, pi/package.test.ts, plugin.test.ts, stop-stopped-daemon.test.ts
- `test/integration/` (7): node-test.test.ts, pi-events.test.ts, pytest-environment.test.ts, pytest.test.ts, setup-missing-import.test.ts, status-wait-edit.test.ts, status-wait-sync.test.ts
- `test/lint/` (1): cli/bundled.test.ts
- `test/runner-host/` (1): pytest-parity.test.ts
- `test/runners/` (1): pytest/spawned.test.ts
- `test/scheduler/` (41): backlog-cancel.test.ts, backlog-quiet.test.ts, backlog-slots-overhead.test.ts, backlog-slots.test.ts, backlog-tiers.test.ts, backlog.test.ts, catch-up-cancel.test.ts, catch-up-order.test.ts, catch-up-turn.test.ts, command-hold-slow.test.ts, command-hold.test.ts, discards.test.ts, edit-beside-backlog.test.ts, edit-cut-route.test.ts, edit-cut.test.ts, editor-scratch.test.ts, first-observation.test.ts, focused-vitest.test.ts, forced-requeue.test.ts, model-scheduler.test.ts, observed-inputs.test.ts, ordering.test.ts, pytest-slots.test.ts, refinement-lock.test.ts, rekeyed-duration.test.ts, revision-lag.test.ts, runner-work.test.ts, runs.test.ts, slow-rank.test.ts, slow-release.test.ts, slow-tier.test.ts, strict-lookup.test.ts, superseded-claim.test.ts, tier-ended-files.test.ts, tier-yields-claim-ends.test.ts, tier-yields-named.test.ts, tier-yields-overrun.test.ts, tier-yields.test.ts, timed-out-tier.test.ts, withheld-retry.test.ts, withheld-touch.test.ts
- Not run: `test/e2e/run-triggers.test.ts` sends `run e2e --wait`; Squeal excludes `test/e2e/**` and it drives the shipped plugins, so CI runs it.

## Decisions the brief did not settle

1. **The words.** A group request (test, slow or lint) says "nothing was queued for group <group>"; "queued" fits all three answers ("test files queued", "slow files queued", "lint checks queued"). The narrow run names the files its paths select, so it does not read as the whole group. Each names its group, so the error stands alone where it is stored or shown without the command's prefix.
2. **`afterPass` carries the text** (`string` in place of `true`), not derived from `operation`: `run --all`'s text must stay "no checkpoint was planned", which `operation` ("taking a squeal run --all request") does not give, so a derived text would need an override for it anyway. This is the one type change; every declaration of the variant is one of the three start rules or a test probe.
3. **The narrow run names its group too.** It shares `takenRequest`'s `runFailed` with `run <group>`, so it now prints `squeal run unit failed:`, not the literal; its error text names the paths.
4. **Only a refused pass gives `run --slow --wait` exit 3.** Other failures of the slow request keep exit 1 ("no other exit code changes"). `run <group> --wait` gives 3 on every failure; aligning the slow wait's other failures is not this row's.
5. **The CLI matches a refused pass by `NO_PASS`'s head**, imported from `request-intake.ts`, so a daemon from before the row (same head, old ending) gets the same exit code.
