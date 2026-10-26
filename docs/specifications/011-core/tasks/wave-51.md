# Wave 51

From main after 0.1.336 (`7e6f62f08`; 0.1.339 is in review on other files), 2026-10-26. The human's card of 2026-10-26: gh-98 "Reword" (row 011-244), gh-101 "Report it" (row 011-245). Row 011-246 is a test-only fix of a flaky case seen in cand/0.1.336's CI. Three rows on disjoint seams. Host load is about 11 to 18 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-244 (gh-98), a flaky note says "under the same tracked inputs"

Use /worker. Shape: slice. Row 011-244; `research/issue-98.md`; 011 C5.

Outcome: a FAIL -> PASS at one key reads "under the same tracked inputs", and the report that names it points to `inputs` in `squeal.config.json` once per note.

Seam: `flakyText` (`src/core/state/flaky.ts:96`) and its readers in `src/core/delivery/failure-groups.ts`, `format.ts` and `src/core/status/format-why.ts`. First edit, offered as a lead: the words in `flakyText`, then the one pointer where a report first names a note. Send the exact new lines to the coordinator as a request before you commit them.

Owns those files, the evals texts that match the note (`test/evals/retry-texts.ts`, `retry-claim.test.ts`, and an `evals/lib/` parser if one reads it), and their tests. Not yours: `src/runners/`, `src/core/daemon/`, `test/store/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds: an untracked data change, a declared data change (no note: its key moves) and a real same-key flip give consistent notice and `why` output; the evals parser gate round-trips the new line through the real formatters.

## W2: 011-245 (gh-101), status names a test's child left alive after a cut Vitest run

Use /worker. Shape: slice. Row 011-245; `013-vitest-runner/research/issue-101.md` (findings 2 and 5); 013 V7, V8, V10; 011 C13 (process reaping), C6.

Outcome: when a Vitest run is cut, a process its worker started that is still alive after the close is named in a daemon note and in status (PID, command, the run); Squeal stops nothing it does not stop today.

Seam: `execute` (`src/runners/vitest/run.ts:71`, the forced cancel at `:117`-`:120`) and the sweep's scans in `src/core/daemon/escaped.ts`. First step: send the coordinator, as a request, how you read a worker's descendants before the forced cancel on Linux (`/proc/<pid>/task/*/children`) and on macOS (`ps`), and where the note is stored and printed, before you build on it. The research's probe (`research/probes/issue-101/`) is evidence only: build your own fixture under the test tree, never run the probe.

Owns `src/runners/vitest/run.ts`, `src/core/daemon/escaped.ts`, the status line that prints the note (if it lives in a W1 file, ask first), and their tests. Not yours: W1's files, `test/store/`, the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds: the slow-teardown and blocked cases name the holder's PID and command after the run; a cooperative teardown names none; the sweep's tests pass unchanged; no process is killed that was not before; every test child is killed by the test itself.

## W3: 011-246, the WAL-switch opening test's holder cannot fail its own COMMIT

Use /worker. Shape: repair (tests only). Row 011-246.

Outcome: the holder in "waits out a write lock another process holds when it switches the file into WAL" commits even when the opener holds a lock at that instant, so only the opener's wait is under test.

Seam: `HOLD_WRITE_LOCK` (`test/store/opening.test.ts:105`). First edit, offered as a lead: open its `DatabaseSync` with a busy timeout. Explain in your notes why SQLite let the holder's `COMMIT` meet the opener's lock.

Owns `test/store/opening.test.ts`. Not yours: `src/`, other tests, the board. No `npm run build`.

Done when an opener changed to never wait still fails the test (a deliberate break, reverted before commit; paste both runs), and the file passes.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. Run each test file that imports a changed module directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits. Never open a live store, socket or permit pool from a probe. Make no CPU load on purpose.
