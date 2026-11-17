# 009 wave 4: the Pi idle-wake tests say what they saw at a timeout

Row 009-30, re-scoped by the human 2026-11-17: diagnostics only; no fix until they show the cause. Coordinator: session 4d2ecbfc. One worker. Test-only: no file under `src/`, no version raise, no build, no full suite.

## W1: 009-30, diagnostics

Use /worker. Shape: slice. Outcome: the next CI failure of "the idle wake was never armed" or "timed out … waiting for the idle wake" prints enough to name the step that lost the wake.

Read: `research/idle-wake-not-armed.md` (what is known, what CI logs do not show, its list of facts a timeout should print); rows 009-30 and ci-43987606521.

Starting seam: `test/integration/pi-wake.test.ts:66` (the wait for the waiter lock) and `test/e2e/pi.test.ts:190`. Lead: one shared helper that, at a timeout, collects and puts into the error message: whether the waiter process was started, its pid and whether it lives, its exit code or signal, its stderr tail, the waiter lock's state, the consumer's registration, the extension's own log lines for the arm, and the times of each step.

Owns: `test/integration/pi-wake.test.ts`, `test/e2e/pi.test.ts`, a helper under `test/` beside them. Leave alone: `src/**`, `plugins/**`. If a fact cannot be read without a product change, list it in the final message; do not make the change.

Done when: a forced timeout (in a test of the helper, not by breaking the product) shows every fact above in the message; both test files pass, each run directly once with `timeout 900` (the e2e file is outside Squeal's coverage); lint and typecheck pass; write `~`, never a `/home/<user>/` path.

Final message: the message a timeout now prints, in full; facts that need a product change; check results.
