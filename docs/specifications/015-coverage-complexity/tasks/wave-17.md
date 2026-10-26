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

## 015-88: review of candidate 0.1.358 (wave 17)

Use /reviewer. Candidate `cand/0.1.358`, pinned to the SHA in the spawn, on main 0.1.356: ten 015-86 commits, and the version and bundles. Write `reviews/0.1.358.md` in this spec and commit it on your branch.

Read row 015-86, W1 above, `tasks/015-86/notes.md` (its agreements, its decisions and the proposed spec text), `research/node-test-coverage.md`, and spec 015 D8 and D9.

Check, with proof where you can:
1. **The record.** A node:test file's run gives a D8 record: a function a test calls reads covered, one never called reads `untested`; lines a child process or a worker thread runs are not counted; under tsx the lines map through the source map, and the blob is that of the source the loader read.
2. **The switch.** Coverage off: node:test keys are byte-identical to 0.1.356's (`npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.356 HEAD adapter:node-test`). Coverage on: one re-key, and "the candidate stores more". A project under `--test-isolation=none` and a file importing `node:inspector` give no record.
3. **The variable.** The recorder deletes it only in the test file's own process and only when it is Squeal's; a project's own `NODE_V8_COVERAGE` stays.
4. **Outside the brief's files.** The daemon wiring is additive; `IN_PROCESS_ENVIRONMENTS` in `loaders.ts` keeps a node:test preload's module covered; the 015-75 tests moved to pytest keep their meaning; the reload test takes the default coverage.
5. **The notes' decisions 1 to 7**, above all a timed-out run that keeps its completed files' records, and the blob read at map time when no map exists.
6. **Words.** The session-start sentence names Vitest and node:test as recording, and pytest as not measured.

Checks (`docs/process.md`): lint, typecheck, targeted `npx vitest run` of files you name. No full suite. Do not run `npm run build` in your tree. `test/cli/codex-trust.test.ts` fails with the host's Codex 0.164.0 (row 011-258), not from this candidate. Name the candidate's CI result or say it is pending. Label findings proven, plausible or unverified. Verdict PASS or FAIL; only a proven break blocks.
