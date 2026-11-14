# 011-338: a held-Stop stand-in outlives a test run cancelled mid-test

Wave 90 W4. Tests only; no `src/**` change.

## The change

`test/harness/opencode/held-stop.ts` writes the stand-in `stop.mjs`. Before, the held stand-in polled for its release file every 5 ms and had no other end. When Squeal cancelled a dispose-test run mid-test, the Vitest worker died, no cleanup ran, and the detached stand-in polled forever (011-336 notes, "Open").

Now, at each 5 ms tick, before it checks the release file, the stand-in exits with code 0 and no answer when either:

- the barriers' folder (`dirname(log)`) is gone. `tempDir`'s `afterEach` removes it after a normal test. After a cancelled run, it is gone only if something removes it later, so this check alone is not enough.
- OpenCode's process is gone. The stand-in reads `pid` from the request on its stdin. The plugin sets `pid` to its own `process.pid`, which is OpenCode's (`OcHost.pid`, spec 008 D2). This is the same check the `wait` bridge makes (`alive` in `src/harness/opencode/bridge-turn.ts`, every 1 s). EPERM counts as alive, as it does there.

The `exit` log line is now written inside `try`, because the folder that holds the log can be the thing that is gone.

## Tests

In `test/harness/opencode/held-stop.test.ts`, "the held stand-in Stop ends with its run (row 011-338)". Each case starts the stand-in as the plugin does (`node stop.mjs`, detached, request JSON on stdin) and waits for its `stop` mark:

- folder removed: the stand-in ends within 2 s;
- `pid` of a process that has ended: the stand-in ends within 2 s and does not answer;
- both present: it is still running after 200 ms, then answers `OLD` with exit code 0 at its release.

Red before the change: the first two failed ("Matcher did not succeed in time"); the third passed.

The done-when says "a test cancels a run mid-test". The test does not cancel a real Squeal run. It removes the folder, or gives a dead OpenCode pid, which is what a cancelled run leaves behind, as the brief's first edit states.

## Effect on the dispose tests

During a dispose test, OpenCode lives and the folder exists, so the new checks do not end the stand-in. `stopGone` reads an `exit` mark as "exited on its own", not as a miss. That mark can now also come from these checks, but only after OpenCode is gone or the folder is removed, which is after the test's barriers.

## Checks run

- `node node_modules/vitest/vitest.mjs run test/harness/opencode/held-stop.test.ts` (Node 26.13): red 2 failed / 7 passed, then 9 passed.
- `squeal status --wait 60000` on `held-stop.ts`, `held-stop.test.ts`, `opencode-dispose.test.ts`, `version-sensitive.test.ts`: all current, no known failures.
- Direct runs of `opencode-dispose.test.ts` and `held-stop.test.ts` with private HOME and TMPDIR: Node 22.19.0 12 passed, Node 24.22.1 12 passed. Node 26.13 through Squeal.
- `pnpm run lint`, `pnpm run typecheck`: clean.
- Afterwards, `pgrep` found no stand-in left from these runs.
