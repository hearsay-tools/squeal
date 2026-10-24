# Wave 2: coverage and CRAP

Wave 2a dispatches after 0.1.293 (013-07, 015-18) is on main: W1, W2, W3 and R3 run in parallel on disjoint seams. W1, W2 and W3 are bundle changes and land as one candidate after a review. Wave 2b (015-12, CRAP and "no test runs it") is briefed once W1's record shape and R3's answer are in.

## W1: 015-11, Squeal's coverage provider and the records

Use /worker. Shape: slice. Outcome: with `coverage.enabled`, each Vitest run Squeal makes anyway leaves one coverage record per test file in the code store, keyed with the test file's result, with no extra run, no project package and no report.
- Read spec D1 (`coverage.enabled`), D4, D8 and D10, goals 9 and 10, `research/coverage-collection.md` (Q1, Q4, Q5 and the recommendation) and its probes, and 013-07's notes.
- **Seam.** `#start` in `src/runners/vitest/adapter.ts`, where 013-07 passes `coverage: { enabled: false }`: with the policy on, pass D8's `provider: "custom"` options instead. The provider's worker side takes V8 precise coverage through `node:inspector`; its main side keeps each test file's payload. Map it through the transform's source map to lines and function ranges outside the scheduler's path, and store D8's record in the code store (a new table) at the result key plus a provider version, adopted with the result (011-23) and pruned with it (C7).
- **Fidelity.** A test file whose closure imports `node:inspector` or `inspector` runs with coverage off, and status names it. `isolate: false` projects run with coverage off, with one note.
- **Owns.** `src/runners/vitest/**`, a new `src/core/code/coverage/**`, the code store schema for the record, the policy key, and their tests. Leave `src/core/code/count/**` to W2.
- **Done when.** Goal 9's cost on the research's 30-file sample, five alternated off/on pairs with the one-minute load beside each; goal 10 (the research's `self-coverage.test.ts` passes with coverage on, and status names it); a second worktree adopts a record with its result; policy off is byte-identical and opens no code store. Lint, typecheck and `squeal run --all --wait` pass (bundle drift expected); paste the output. Do not build bundles or raise the version.

## W2: 015-29, `import(...)` in a type argument parses

Use /worker. Shape: slice. Outcome: the counter parses `typeof import("x")` and `import("x").T` in a type argument, and every function in such a file counts as ESLint counts it.
- Read the row 015-29, `research/typeof-import.md` (r2) and its probes, spec D3, and `tasks/015-23/notes.md` (the NUL rewrite that keeps offsets).
- **Seam.** Before the TSX parse in `src/core/code/count/parser.ts` or `typescript.ts`: replace each `import("x")` that follows `typeof `, `<` or `,` with underscores of the same length. The walk and the body hashes read the file's own text. Raise `COUNTER_VERSION` to 3.
- **Owns.** `src/core/code/count/**` and `test/code/count/**`. Leave `src/runners/**` and the store to W1.
- **Done when.** The row's fixtures: the two misparses count like ESLint, and the same text in a string, a comment and a template literal is untouched. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## W3: 015-31, a held edit reports no crossing that only a later threshold change made

Use /worker. Shape: repair. Outcome: an edit whose count failed and that a threshold recount held tells only its own crossing; a crossing that only the new threshold makes is the recount's summary (D1), never a per-function line or a session regression.
- Read the row 015-31, `reviews/0.1.293-r2.md` N1 (the reproduction and the repair scope), spec D1, D4 and D6, and `tasks/R2-0.1.293/notes.md` (the `quiet` flag on a failed count).
- **Seam.** `src/core/code/pass/failed.ts` and the judge in `pass.ts`: keep the policy (threshold) the failed edit was made under with its record, and judge its retry as the edit under that policy, then the policy change as the recount's.
- **Owns.** `src/core/code/pass/**` and `test/code/pass/**`. Leave `src/core/code/count/**` to W2 and `src/runners/**` and the store schema to W1.
- **Done when.** Delivery and session-regression tests: CC 3 -> 4 with the threshold moved 20 -> 2 while the edit's count is held tells nothing per function; a genuine CC 3 -> 23 edit under the same sequence still tells FAIL; the R2 tests stay green. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## R3: open question 3, code that tests reach only through child processes

Use /researcher, with the rules in `research/README.md`. Outcome: how many of this repository's `src/` functions no in-process Vitest test runs while a test that spawns a child process does, so that they would read "no test runs it" under D9.
- Questions: (1) the functions in `src/` that in-process coverage never runs, from one coverage run of the whole suite in a scratch copy under `/tmp` with `@vitest/coverage-v8` added there only; (2) of those, the ones that a child-process test reaches (the CLI, the daemon, hooks; `test/e2e/**` and tests that spawn `squeal`), and how that can be known without coverage of the child; (3) what D9 should do with them: `unknown`, a project setting, or child coverage through `NODE_V8_COVERAGE`, with its cost.
- Own `research/child-processes.md` and `probes/child-processes/`. One full-suite run in the scratch copy is allowed, under `flock /run/user/$(id -u)/squeal-full-run.lock`, at `--maxWorkers=4`.

## 015-32: review of candidate 0.1.295

Use /reviewer. Candidate `cand/0.1.295`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>` at 0.1.294: rows 015-29, 015-31 and 015-11, plus one build commit (bundles, version 0.1.295, the new `dist/coverage/provider.mjs` in each plugin). Write `docs/specifications/015-coverage-complexity/reviews/0.1.295.md` and commit it on your branch.

Read `spec.md` D3, D4, D8 and D10 with their 2026-10-24 amendments, `status.md` (2026-10-24), W1 to W3 above, and `tasks/015-11/notes.md`, `tasks/015-29/notes.md`, `tasks/015-31/notes.md`.

Check, with proof where you can:
1. **015-11, policy off.** Keys byte-identical to 0.1.294, `coverage: { enabled: false }`, no `code.sqlite`, no `coverage/` folder, no provider loaded.
2. **015-11, policy on.** Records match what ran (a source line and a function hit, an early return, a lazy function); the run-ID join; a focused, cancelled or crashed run leaves no record; `node:inspector` and `isolate: false` files take no coverage and still pass; payloads are deleted; a second worktree adopts the record with the result; the prune drops records and old counts and nothing still in use; the mapping stays off the scheduler's path. The key marker: no path or worktree value, two worktrees share keys; judge the one-time re-key and the validity cases the worker added in `test/keys/validity/`.
3. **015-29.** The rewrite keeps every offset and touches no string, comment or template; names and body hashes read the file's text; the regex is linear.
4. **015-31.** The held-edit rule against the six tests and the residue the worker named (a move out of a held file across a threshold change).

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Under host load, name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R4: repair of review 0.1.295 B1, the import rewrite (015-29)

Use /worker. Shape: repair. Starts from `5e18ed2b0` (`int/015d-r1`: 015-29, 015-31 and 015-11 on 0.1.294, no build commit). R5 runs beside it. Outcome: the `import("…")` rewrite changes only real import syntax, never text inside or across strings, comments, templates or regular expressions.
- Read `reviews/0.1.295.md` B1, spec D3 with its 2026-10-24 amendment, `tasks/015-29/notes.md` and `research/typeof-import.md`.
- **Lead.** In `tsxInput` (`src/core/code/count/parser.ts`), keep the regex as the candidate finder. Accept a match only when a parse of the unrewritten text puts `import` in no string, comment, template or regex, and reads the quoted part as one string whose range is the match's literal. Parse twice only when a candidate exists. Another token-aware scan is fine if it meets the done-when.
- **Keep.** The same-length replacement; names and body hashes from the file's own text; `COUNTER_VERSION` 3 (never released, so no raise).
- **Owns.** `src/core/code/count/**`, `test/code/count/**`. Leave `src/runners/**`, `src/core/code/coverage/**` and `src/core/code/pass/**` alone.
- **Done when.** The review's reproduction is a test, red first: `hidden` counted at CC 2. The same holds for a two-comment form (`/* typeof import(' */ function f(a) { return a ? 1 : 2 } /* ') */`), a template form and a regex-literal form. Both type-import fixtures and the quoted-key test still pass. The 1,972-file comparison in `tasks/015-29/notes.md`, re-run against `5e18ed2b0`'s counter, gives 0 changed functions and 0 files with errors. Lint, typecheck and `squeal run --all --wait` pass (bundle-drift failures expected); paste the output. Do not build bundles or raise the version.

## R5: repair of review 0.1.295 B2 to B4, the coverage boundary (015-11)

Use /worker. Shape: repair. Starts from `5e18ed2b0`, beside R4. Outcome: a setup file's inspector import turns coverage off for its project's files, the cancelled-run rule is pinned by a test, and the mapping test passes on Node 22 and 24.
- Read `reviews/0.1.295.md` B2 to B4, spec D8 with its 2026-10-24 amendments (B3's sentence corrected, see `status.md`), and `tasks/015-11/notes.md`.
- **B2.** `inspectorFiles` (`src/runners/vitest/coverage.ts`) also reads each project's setup closure (`ProjectInputs.setup` in `src/runners/vitest/project.ts`). When it imports `node:inspector` or `inspector`, every selected file of that project takes no coverage and is named in the note. Keep the direct, transitive and `isolate: false` cases.
- **B3, the coordinator's decision.** A test file that completed whole before a cancellation keeps its record; no product change. Add the review's probe as a test: a cancelled run with one completed sibling stores that sibling's record, and none for the file the cancel stopped, whose payload is deleted. Assert that hung, crashed and rejected runs delete every payload, where no test does yet.
- **B4.** `own-provider.test.ts:112` asserts what holds on both engines: called functions hit, the uncalled arrow and class members have no hit, the early return's lines, and every function range maps into `src/math.ts`. Run the file on Node 22.23.3 (`~/.nvm/versions/node/v22.23.3/bin`) and 24.21.0.
- **Owns.** `src/runners/vitest/**`, `src/core/code/coverage/**`, `test/runners/vitest/**`, `test/code/coverage/**`, `test/fixtures/vitest/own-provider*/**`, `test/keys/validity/**` if the key-format alarm asks for a case. Leave `src/core/code/count/**` alone.
- **Done when.** Each reproduction is a test, B2's red first; B4's file passes on both engines; `test/keys/key-format.test.ts` passes. Lint, typecheck and `squeal run --all --wait` pass (bundle-drift failures expected); paste the output. Do not build bundles or raise the version.

## 015-32 round 2: re-review of candidate 0.1.295

Use /reviewer. Candidate `cand/0.1.295`, pinned to the SHA named in the spawn; round 1 is `reviews/0.1.295.md` (FAIL on 2bf279d0d, B1 to B4; that SHA is kept as `review/0.1.295-round1`). Write `reviews/0.1.295-r2.md` and commit it on your branch. The candidate is 015-29, 015-31 and 015-11 again, plus repairs R4 (B1) and R5 (B2 to B4) and a new build commit, on main at 0.1.294 and docs since.
- Check each blocker's reproduction and repair scope against R4 and R5 (`tasks/R4/notes.md`, `tasks/R5/notes.md`). B3 is the coordinator's decision, not a code repair: D8 now keeps the record of a file that completed whole before a cancel (`status.md`, 2026-10-24); judge the rule and R5's test that pins it. R5 also fixed a defect it found: a crashed or rejected run with coverage on threw a `TypeError` after `closeEmptied`; check that fix and its validity case.
- 015-31 and the rest of 015-11 passed round 1: re-read only where the repairs touch them.
- Confirm the candidate's CI is green, the Node 22 shards included.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result; name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## W4: 015-12, CRAP and "no in-process test runs it" (wave 2b)

Use /worker. Shape: slice. Starts from main at 0.1.295, beside wave 1d (`wave-1d.md`). Outcome: each counted function gains a `crap` and an `uncovered` state from 015-11's coverage records, judged and delivered like complexity, never before every loader's record is current.
- Read `spec.md` goal 11, D5 to D7 and D9 with its 2026-10-24 amendments (child processes out, "no in-process test runs it", skipped files make `unknown`), D8 for the record; `tasks/015-11/notes.md` (record shape; a function V8 never compiled is absent, not `0`; inventories differ by Node version); `reviews/0.1.295.md` "Inputs for the repair and next wave"; `research/complexity-and-crap.md` 4 (the join by position) and `research/child-processes.md`.
- **The join.** A function's coverage is the union of the records of the current results of every test file whose closure holds the source at its current blob (011 C3's reverse index), by position, never by name. Lead: a pure `joinCoverage` in a new `src/core/code/crap/`, tested on a fixture record first.
- **The states.** `crap` = CC² × (1 − cov)³ + CC, cov of the function's own statements, 95% or more gives CC, `fail` above `crap.threshold` (30). `uncovered` = `fail` when no in-process test runs it. Each is `pending` until every loader has a current record, `unknown` while one cannot (D8's skips, an excluded suite, a file with skipped tests, `unread`).
- **Delivery.** D5 to D7 apply. The FAIL line names CC, coverage and the test files that run the function, worded as evidence, never as a target.
- **Owns.** `src/core/code/crap/**` (new), the state kinds in `src/core/code/store/**` and `src/core/code/pass/**` (not `head.ts`), `src/core/types/code*.ts`, `src/cli/code*.ts`, and new kinds in `src/core/delivery/code-*.ts` and `src/core/status/code-status.ts`, where wave 1d also edits: add, do not rework its functions.
- **Done when.** Goal 11: no state before every loader is current; CRAP equals the formula on a fixture; `unknown` for each cause; a delivery test for each kind; policy off and coverage off byte-identical to 0.1.295. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.
