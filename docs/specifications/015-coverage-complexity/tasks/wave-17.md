# 015 wave 17: coverage from Squeal's node:test runs

Briefed by coordinator 52e58f23 on 2026-10-26. The human chose "node:test: A. Build, same switch" the same day, after `research/node-test-coverage.md` (row 015-76). One worker.

## W1: 015-86

Use /worker. Shape: slice. Starts from main 0.1.354. Outcome: while `coverage.enabled` holds, each node:test file run gives a D8 coverage record, so functions its tests run in process get real `untested` and CRAP verdicts, and node:test leaves the "not measured" set.
- Read `research/node-test-coverage.md` (all of it, and its probes), spec 015 D8 and D9 (as amended 2026-10-26 for 015-75), spec 003 D5 (one process per file), and `tasks/015-75/notes.md`.
- **Lead.** The research's Recommendation 1 to 4:
  1. Per file run, set `NODE_V8_COVERAGE=<logDir>/cov-<i>` for the `node --test` process (`src/runners/node-test/run/run.ts`).
  2. The recorder deletes the variable from `process.env` in the test file's own process at startup (`src/runners/node-test/runtime/recorder.cjs`), so children write none and a test cannot read it.
  3. Map each own script with `mapScript`, through the payload's `source-map-cache` map over its `lineLengths` when there is one; the closing-punctuation rule reads the mapped source. Confirm the blob as `buildRecord` does.
  4. D8's other rules hold: a record only for a whole completed file; a file that imports `node:inspector` runs without coverage.
- **The switch.** `node-test` joins `RECORDING_RUNNERS` (`src/core/code/coverage/runtime.ts`), the one place. A node:test key with coverage on carries the provider marker, as D8 **Keys** does for Vitest, so turning coverage on re-keys node:test checks once and coverage off leaves the keys byte-identical to 0.1.354.
- **Owns.** `src/runners/node-test/**`, `src/core/code/coverage/**`, their tests under `test/runners/node-test/**` and `test/code/coverage/**`, and a node:test case under `test/keys/validity/`. Ask before any other file.
- **Done when.**
  - Red-first tests on the node:test fixtures (`test/fixtures/node-test/`, with tsx): a function a test calls reads covered, and one never called reads `untested`. A child process's lines are not counted. A file importing `node:inspector` gives no record.
  - The key validity case reads "the candidate stores more", and its keys equal 0.1.354 with coverage off.
  - The session-start sentence names only pytest when both runners are configured.
  - Notes in `tasks/015-86/notes.md`, with the D8 text and the Non-goals change you propose; the coordinator amends the spec.
  - Lint, typecheck, and `squeal status --wait 60000 <changed-path>...`; paste both. No full suite. Do not build bundles or raise the version.
