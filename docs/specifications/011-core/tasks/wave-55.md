# Wave 55: rows 011-252, 011-257 and 011-248

Coordinator 04a258b0, 2026-10-26. Three disjoint seams, run in parallel. Host policy for all three (2026-10-25): no local full suite, no `squeal run --all`; affected results through `squeal status --wait 60000 <paths>`; every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; private `/tmp` fixtures only; never make CPU load on purpose, and state the host's real load for each timed run. No `npm run build`. Not yours: the board, spec text, `status.md`, bundles, version. Notes in `tasks/<row>/notes.md`.

## W1: row 011-252 (a slow start draws no extra daemons)

Use /worker. Shape: slice.

Outcome: while a daemon starts, a hook boundary that finds that start current spawns no second daemon.

Read: the board row; `tasks/011-250/notes.md` F3; `tasks/011-251/notes.md` (the marks); 011 C9's 011-251 paragraphs.

Seam and lead: `ensure` (`src/harness/shared/ensure.ts:67`) calls `ensureDaemon` with no look at the start and spawn marks 011-251 added. Measure first in a private fixture: the daemons spawned at PostToolUse, PostToolBatch and Stop while a start is held. Then return before the spawn when a start is current, read as `withDaemonFacts` reads it (`marksOf`): a start mark naming a live process, or a spawn mark in its grace after the last heartbeat with the record cleared. No lock probe. If a new `HookEnsureResult` or any user-visible line is needed, send me the shape first.

Owns: `src/harness/shared/ensure.ts` and its tests, plus a new test file.

Done when: the measurement is in the notes (before and after); a test through the real hook boundary shows one spawn over several boundaries during a held start; a dead start mark, an expired spawn mark and a stale record with only a spawn mark still spawn; `test/harness/spawn-mark.test.ts`, `starting-daemon.test.ts`, `stale-replacement.test.ts` and `test/keys/key-format.test.ts` pass; lint and typecheck pass.

## W2: row 011-257 (`low-priority.test.ts` S1 under CI load)

Use /worker. Shape: repair (test only).

Outcome: the 001-401 S1 case waits for the scan that lowers the carrier, not for a fixed 3 s.

Read: the board row; `test/daemon/low-priority.test.ts:252` and the polls at `:222` and `:238`.

Seam and lead: replace the `waited < 3_000` poll with a wait on the scan's own pass (its event or its count), or a bound taken from the scan's interval. If the product gives no event to wait on, say so in a request before you add one.

Owns: `test/daemon/low-priority.test.ts` and its helpers.

Done when: the case passes 20 of 20 at the host's real load (state it); it still fails with the lowering removed (a deliberate break, reverted; paste both runs); the other cases in the file pass.

## W3: row 011-248 (`departure.test.ts` idle-exit bound)

Use /worker. Shape: repair (test only).

Outcome: the idle-exit case measures the departure decision, not the runner's speed.

Read: the board row; `test/daemon/departure.test.ts:120` and `:172`.

Seam and lead: the 3,500 ms bound counts from the client's SessionEnd to the daemon's exit. Measure from the departure decision, or allow the shutdown's own measured time, and say whether `LOADED` should read a CI runner.

Owns: `test/daemon/departure.test.ts` and its helpers.

Done when: the case passes at the host's real load; it still fails when the exit is held past the grace by a deliberate break (reverted; paste both runs); the other cases in the file pass.
