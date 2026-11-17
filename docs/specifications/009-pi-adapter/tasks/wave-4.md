# 009 wave 4: the Pi idle-wake tests say what they saw at a timeout

Row 009-30, re-scoped by the human 2026-11-17: diagnostics only; no fix until they show the cause. Coordinator: session 4d2ecbfc. One worker. Test-only: no file under `src/`, no version raise, no build, no full suite.

## W1: 009-30, diagnostics

Use /worker. Shape: slice. Outcome: the next CI failure of "the idle wake was never armed" or "timed out … waiting for the idle wake" prints enough to name the step that lost the wake.

Read: `research/idle-wake-not-armed.md` (what is known, what CI logs do not show, its list of facts a timeout should print); rows 009-30 and ci-43987606521.

Starting seam: `test/integration/pi-wake.test.ts:66` (the wait for the waiter lock) and `test/e2e/pi.test.ts:190`. Lead: one shared helper that, at a timeout, collects and puts into the error message: whether the waiter process was started, its pid and whether it lives, its exit code or signal, its stderr tail, the waiter lock's state, the consumer's registration, the extension's own log lines for the arm, and the times of each step.

Owns: `test/integration/pi-wake.test.ts`, `test/e2e/pi.test.ts`, a helper under `test/` beside them. Leave alone: `src/**`, `plugins/**`. If a fact cannot be read without a product change, list it in the final message; do not make the change.

Done when: a forced timeout (in a test of the helper, not by breaking the product) shows every fact above in the message; both test files pass, each run directly once with `timeout 900` (the e2e file is outside Squeal's coverage); lint and typecheck pass; write `~`, never a `/home/<user>/` path.

Final message: the message a timeout now prints, in full; facts that need a product change; check results.

## W2: 009-30, the report prints fixed facts only

Use /worker. Shape: repair. Decided by the human 2026-11-17 after two failed reviews (`reviews/009-30.md`, `reviews/009-30-r2.md`; B2 stayed open): the timeout report prints no free text from Pi. Start from `origin/wip/009-30`.

Rule, one owner (`describeTimeout` in `test/helpers/pi-wake-trace.ts`): every printed value is a fact the test side produces itself or a value from a closed set: pids, alive or not, exit code, signal name, counts, step names from a fixed list, times in ms, byte counts. Never a string that Pi, a worker, an error or the environment wrote. Stderr becomes "wrote N bytes in M writes, first at +T ms, last at +T ms". A probe error becomes its error code when it is in a known set (`ENOENT`, `EACCES`, …), else "other". An unknown event or step name becomes "other".

First edit: remove `safeText` and its tests; the preload stops recording stderr text (sizes and times only), so the text is not on disk either. Keep B1 (Pi's run, not the installer), B3 (the exit of a terminated worker) and S1 as repaired.

Owns: `test/helpers/pi-wake-trace.ts`, `pi-wake-trace.test.ts`, `pi-trace-preload.mjs`, and the two Pi test files only if a call changes. Leave alone: `src/**`, `plugins/**`, `test/e2e/pi-fixture.ts`.

Done when: a test that feeds home paths, secrets in every form the two reviews used, and arbitrary text through stderr, a probe error, an event name and a worker message, and asserts that the report matches a strict pattern of allowed tokens (not that markers are absent); each changed test file run directly once, `timeout 900`; lint, typecheck; `squeal status --wait 60000` on the changed paths. No version raise, no build, no full suite. Write `~`, never a `/home/<user>/` path.

Final message: the report a timeout prints, in full; the allowed-token pattern; check results.
