# Issue #106: "untested" for a module a node:test preload also imports

Researcher, 2026-10-26. Brief: issue #106 triage reproduction (about 20 minutes). Probes: `probes/issue-106/` (throwaway). Version examined: this branch at `a36f6bde7` (0.1.352), its built CLI `plugins/claude-code/dist/cli/squeal.mjs`, Node 24.21.0. Every run used `HOME`, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` under `/tmp/issue-106/home`; no evals script ran. One run (fixture `d-two-projects`, `run --all`) started at a one-minute load of 44.5, above the brief's limit of 24, because the load check and the start were in one command. Every other run started at a load of 12 to 22.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Why "untested", `testFiles: 0`? | Not the preload. The source was judged `untested` while no test file loaded it. When a node:test test file starts to load it, the source turns `unknown` (node:test gives no coverage record), and D9 keeps a `pending` or `unknown` source's last judged states. So the old `fail` stays, with its old evidence of 0 test files, after the test exists and after a restart. | experiment (`e-order`); source |
| 2 | Hypothesis: the preload files the path under the environment, not the test's closure | Refuted for a module the test file also imports: the test file's own closure holds it, with or without the preload, also with two projects that share the preload. Confirmed only for a module that **only** the preload loads: it has no loader and reads `untested`. | experiment (`a-preload`, `d-two-projects`); source |
| 3a | The same module without the preload | Same as with the preload: the test file is its loader; the file reads `unknown` (after a restart, see 5). | experiment (`b-plain`) |
| 3b | Vitest `setupFiles` import of the source | No gap. The source reads 100% covered from the test file's record. | experiment (`c-vitest`) |
| 4 | Regression since 0.1.341? | Not a code regression. 0.1.341 (`a2ab372a2`, 015-64) made `coverage.enabled` default `true`. Before it, the reporter's config (only `complexity.enabled`) had no CRAP or `untested` states, so the case could not show. The rule that keeps the stale state is D9 as written (spec line 252). | source |
| 5 | Found on the way: `pending` never turns `unknown` in a live daemon | In every fixture, a node:test-only source stayed "waits for coverage records" for over 2 minutes (D9 says `unknown` after 36 s). A daemon restart made it `unknown` at once. Cause not determined in the time bound. | experiment |

## Findings

### Q1. The cause (verified by experiment, read in source code)

Fixture `e-order`: one node:test project, `scripts/helper.mjs`, and at first only an unrelated test file.

1. `run --all`: `classify` reads `CRAP 20; untested: no test runs it in its own process`. Correct at that time: no test file loads the helper.
2. Add `scripts/helper.test.mjs`, which imports and calls `classify` in process. It runs and passes. `squeal code --json` still gives `"uncovered": "fail", "testFiles": 0`; status says `1 file waits for coverage records`.
3. Restart the daemon. Status: `0 functions over CRAP 30, 2 untested; 1 file unknown (1 from a test file with no coverage record)`. `squeal code` still prints `untested` for both functions. The two lines contradict each other.

This is the issue's shape: `testFiles 0`, `untested`, and it stays after a restart. The reporter added `scripts/test-sandbox.mjs` and its test in one session (hearsay-tools/cezarion#1917). Whenever the helper, or the preload that imports it, was saved before the test file, the helper was judged with no loader first. The order in that session is not determined from here.

The path, by file and line:

- `src/core/code/crap/loaders.ts:126`: a node:test loader's result has no record; after `RECORD_WAIT_MS` (36.25 s) it is `unknown`, cause `no-record`.
- `src/core/code/crap/file.ts:61`: one `unknown` loader makes the whole source `unknown`.
- `src/core/code/crap/walk.ts:65-67`: a source that is not `ready` gets a `pending` or `unknown` file summary and nothing else. Its function states (`crap`, `uncovered`) and their evidence stay as last judged.
- Spec 015 D9, **First judgement** (spec line 252): "A pending or unknown source keeps its last judged states." This is the rule as written, so the code follows the spec.
- `squeal code` and the status count read the kept function states; the "1 file unknown" part reads the file summary.

The CRAP in the issue (up to 110) is the same kept state: a CRAP judged at coverage 0.

### Q2. The preload hypothesis (verified by experiment, read in source code)

- `src/runners/node-test/graph/closures.ts:54`: each test file's closure is its own import closure. The preload's closure is a separate set (`:55-58`) that goes to the environment hash. Nothing removes a preload path from a test file's closure, and `assembleClosure` (`src/core/keys/closure.ts:163-194`) only adds paths.
- `a-preload` (`--import ./scripts/preload.mjs`, which imports the helper) and `b-plain` (no preload) gave the same result. `squeal status scripts/helper.mjs` selects `scripts/helper.test.mjs` in both, and both read `unknown` after a restart.
- `d-two-projects` copies cezarion's shape: a second project with `cwd: packages/p` and the same preload as `../../scripts/preload.mjs`. Same result for the helper.
- A module only the preload loads: in `d-two-projects`, `onlyPreload` in `scripts/preload.mjs` reads `CRAP 6; untested`. `src/core/code/crap/loaders.ts:180` takes loaders only from test file closures, so the module has none (`file.ts:67`: `ready` with no loaders). It runs in every test file's process, so `untested` is wrong for it too. For node:test the honest state is `unknown`. This case does not apply to `scripts/test-sandbox.mjs` in the issue, which its test imports directly (read at cezarion `98ad4185`, `scripts/test-sandbox.test.mjs:10`).

### Q3b. Vitest `setupFiles` (verified by experiment)

`c-vitest`: `setup.ts` imports `src/helper.ts` and calls `classify`; `test/helper.test.ts` imports it too. Result: `classify CRAP 4; 100% of its lines ran in 1 test file`, and `unused` (never called) `untested`. Squeal's provider measures the whole worker process, setup included, so there is no gap when the test file also imports the source. A source only a setup file imports was not tested.

### Q5. Live wake (verified by experiment; cause not determined)

In `a-preload`, `b-plain`, `d-two-projects` and `e-order`, a source whose only loader is a node:test file stayed `pending` ("waits for coverage records") for 2 to 3 minutes, past an edit and a re-run. `stop` and `start` made it `unknown` within seconds. The wake that should end the wait is `retryLater` in `src/core/code/pass/index.ts:298-312`, set from the step's `wakeAt`. I did not find why it does not judge again. A fake-clock unit test over `createCodePass` with one node:test-shaped loader would decide it.

## Recommendation for Squeal

1. **Drop the kept `fail` when the loader set changes** (fixes the issue). When a source turns `pending` or `unknown` and its loader set differs from the one its last judgement saw, its `crap` and `uncovered` states should go to `pending` or `unknown` too, with no transition line. The judgement's signature already holds the loaders, so "the loaders changed" is known. Narrower option: drop only states judged with zero loaders. This changes D9's **First judgement** rule, so the coordinator must amend the spec.
2. **A preload-only module reads `unknown` under node:test.** Treat a path in a node:test project's preload closure as loaded by every test file of that project, so it gets the `no-record` cause. For Vitest, the same for a `setupFiles` closure would give it real coverage. This needs a `ClosureIndex` view of each project's environment paths for the loader map.
3. **Fix the live wake** (Q5) as its own row. Without it, fix 1 shows `pending` until a restart instead of `unknown`.
4. **Wording.** The issue's suggestion "not measured" fits: for an `unknown` source, `squeal code` should print the reason ("node:test gives no coverage"), not the kept state.

## Open questions

- The order of saves in the reporter's session (helper or preload before the test) is not determined. It decides whether fix 1 alone clears their case; the mechanism above gives the issue's exact output either way.
- Q5's cause.
- A source that only a Vitest `setupFiles` module imports: not probed.

## Sources

- Issue: `gh issue view 106 --repo hearsay-tools/squeal`. Reporter's config and files: hearsay-tools/cezarion at `98ad418504d4` (PR #1917 head), `squeal.config.json` `nodeTest`, `scripts/test-sandbox.test.mjs`, `scripts/test-git-env.mjs`.
- Spec: `docs/specifications/015-coverage-complexity/spec.md` Non-goals line 40, D9 lines 239-252.
- Code at `a36f6bde7`: `src/core/code/crap/{loaders,file,walk}.ts`, `src/core/code/pass/index.ts`, `src/runners/node-test/graph/closures.ts`, `src/core/keys/closure.ts`. Default change: `a2ab372a2` (015-64), released in 0.1.341 (`663cb5485`).
- Probes: `probes/issue-106/setup.sh` (fixtures a to e), `run.sh` (isolated CLI), `README.md`.
