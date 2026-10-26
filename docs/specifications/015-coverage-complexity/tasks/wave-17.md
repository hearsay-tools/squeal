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

## W1 R1: 015-86 repair (review 0.1.358 B1)

Use /worker. Shape: repair, on your own branch `cez/9ca0bc6a` (the coordinator cherry-picks it onto `int/015w17`). Outcome: a node:test record under a loader never pairs old coverage with bytes read after the run; a source's blob is the one the loader read, or the source is `unread`.
- Read `reviews/0.1.358.md` (B1, its probes and "Input for the repair"). Cause: the recorder deletes `NODE_V8_COVERAGE` before tsx initializes, and tsx keeps `sourcesContent` only while that variable is set, so `own.ts:58` reads the disk at map time.
- **Lead, pick one and say why in the notes.** (a) Confirm the bytes: the recorder's `registerHooks` (it already holds the graph hooks) records the blob of each own file as the loader read it, beside `own-<pid>`; `ownSource` takes disk bytes only when they hash to that blob, else `unread`. (b) Keep the text: tsx sees the variable until it has transformed, while the test, its children and its threads still never see it; prove with the reviewer's child and worker-thread probes. Without either, a source whose own map has no `sourcesContent` is `unread`.
- **Owns.** As W1, plus its agreed files.
- **Done when.** A real tsx adapter test, red first: edit the source after the run and before mapping; the record has the original blob or the source `unread`, never the edited blob, through both the mapping worker and the main thread. Run it on Node 22 and 24 (the host has both; say how). The no-map decision 2 stays as it is. Notes updated; lint, typecheck, `squeal status --wait 60000 <changed-path>...` or the targeted files; paste both. No full suite, no bundles, no version.

## 015-88 R1: re-review of candidate 0.1.358 after repair R1

Use /reviewer. Candidate `cand/0.1.358`, pinned to the SHA in the spawn: the reviewed `9e4da8e41` plus the repair commits and rebuilt bundles. Write `reviews/0.1.358-r2.md` and commit it alone on your branch. Read `reviews/0.1.358.md` and the repair commits. Check: (1) B1: your real tsx edit-before-map probe on Node 22 and 24 now gives the original blob or `unread`; (2) unchanged: process ownership, the switch and keys (validity against 0.1.356), the seven decisions; (3) the repair adds no work per loaded file beyond what its notes measure. Checks as round 1. Verdict PASS or FAIL; only a proven break blocks. This is the last round for this wave.

## W1 R2: 015-86 on Node 22.19 (candidate CI 40405629970)

Use /worker. Shape: repair. Starts from `cand/0.1.358` `b1cd88158`; do not rebuild bundles or raise the version (the coordinator does). Outcome: on Node 22.19.0, CI's Node 22 and the lowest Squeal supports, a tsx node:test file's record holds the source text tsx ran, as on 22.23.3 and 24.21.0.
- **Evidence.** CI run 40405629970, job "Node 22 (2/3)": three tests in `test/runners/node-test/coverage.test.ts` fail, "reads a function a test calls covered, and one never called untested" (`expected undefined to be '6f40f6c7…'`), "keeps the blob of the text tsx ran when the source changes before mapping" and "counts no line of a process the test spawns" (`expected [] to deeply equal [...]`). The first candidate's CI (40399547452, the recorder before repair R1) passed them on 22.19, so R1's change of where the recorder deletes `NODE_V8_COVERAGE` is the seam. Reproduce first: `PATH=$HOME/.nvm/versions/node/v22.19.0/bin:$PATH npx vitest run test/runners/node-test/coverage.test.ts`.
- **Lead, a hypothesis to check.** On 22.19 tsx may install its hooks with `module.register`, so its transform runs in a hooks thread, and the recorder's resolve hook may take that call's file URL (parent `null`) for the test file's entry and delete the variable before the thread starts. If so, know the entry by `process.argv[1]`. If 22.19 cannot keep the text, its sources stay `unread`, the tests say so for that Node, and the notes give the reason.
- **Owns.** `src/runners/node-test/runtime/recorder.cjs`, `src/core/code/coverage/own.ts`, `test/runners/node-test/**`, `test/code/coverage/**`, `tasks/015-86/notes.md`.
- **Done when.** The three tests pass, run directly, on 22.19.0, 22.23.3 and 24.21.0; the test, a child and a thread still see no variable; notes section "Repair R2". Lint, typecheck; paste both. No full suite.

## 015-88 R2: narrow review of repair R2

Use /reviewer. Candidate `cand/0.1.358`, pinned to the SHA in the spawn: the passed `b1cd88158` plus the R2 commits and rebuilt bundles. Write `reviews/0.1.358-r3.md`. Check only R2: the three tests and your tsx edit-before-map probe on Node 22.19.0 (the host has it), 22.23.3 and 24.21.0; process ownership unchanged. Targeted checks only. Verdict PASS or FAIL; only a proven break blocks.
