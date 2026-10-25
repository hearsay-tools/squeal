# 015-58: why every function of a validity harness file reads "no in-process test reaches it"

Researcher, 2026-10-25. Brief: `../tasks/015-58/brief.md`. Probes: `probes/validity-harness-uncovered/` (throwaway). Versions examined: main `20a6be623` (the coordinator worktree's HEAD; `assemble.ts` is blob `6f9abf9`, unchanged since `5cd5d6118`), host `squeal` 0.1.321, the coordinator worktree's row in `store.sqlite` (`95f8346992f91e4f`, revision 252 newest, `daemon_version` 0.1.318 in that row), `COVERAGE_PROVIDER_VERSION` 2, Node 24.21.0. Every store read went through `node:sqlite` with `readOnly: true`.

**Verdict.** The reading is true by D9's definition, and D9's pending rule did not fail. Every function of `assemble.ts` runs, but only in a `node` child that runs an esbuild bundle of the validity driver. No Vitest worker process calls any of them. D9 and the non-goal "Coverage of code that tests reach only through a child process" make such a function read `fail`. For the agent the line is still misleading: five passing test files run all 16 functions. R3 counted 50 child-only functions, all under `src/` (`child-processes.md`). This one harness adds 153 child-only functions under `test/`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which test files load `assemble.ts`, and does one run `assemble` in its own process? | 7 test files hold it in their closure. 5 of them load it in-process. None calls a function of it in-process. All 16 functions run in the driver child: 17 of 17 `assemble` cases ran, and each function was called 1 to 30 times. | store read; experiment |
| 2 | Each loader's result, record, and the source's blob in the record | All 7 have current `pass` results with no skip, and a provider-2 record. 5 records name `assemble.ts` at blob `6f9abf9` (current): lines 1–5, 11–13, 16, 18, 19 ran (imports and constants). The 9 V8 functions all have hit 0. 2 records have no entry for the source. | store read |
| 3 | Why `fail`, not `pending` or `unknown` | Every loader is `ready` (current key, result in hand, no skip, record stored), and no record lists the source as `unread` at another blob. So `fileCondition` gives `ready`. `joinCoverage` gives `ran: false` to all 16 functions, so coverage 0 and CRAP = CC² + CC. | source code; store read |
| 4 | How many other sources read so for the same cause | In the coordinator worktree: 153 functions in the 14 `test/` files of the driver bundle (158 counted), 15 of them also over CRAP 30. Four other judged worktrees on the host read 152–153 too. 40 more functions in 3 harness files and 12 in a Python file are related but not the same cause. | store read; experiment |

## Findings

### Q1. The loaders, and where `assemble` runs

- **The import path** (read in source code, `20a6be623`). `test/keys/key-format.test.ts` and `adapters`, `compare`, `pytest` and `reach.test.ts` under `test/keys/validity/` each import `driver.js` "so their closure holds the entries and the harness". All five closures also hold `sides.ts`, which imports `node:child_process` (store read). `driver.ts` imports `harness.ts`, which imports `./harness/assemble.js`. Imported, `driver.ts` "runs nothing": its main block runs only when `process.argv[1]` is the driver itself.
- **Where it runs** (read in source code). `sides.ts` `execute` and `launch` start `spawn(process.execPath, [side.file, mode, …])`. `side.file` is the esbuild bundle that `bundle.ts` builds into a temporary work directory. The child gets `NODE_V8_COVERAGE`, and the harness reads that coverage for its own proof (`coverage.ts`). `harness.ts` `runCase` calls `assemble(c.input, scratch)` for each case of kind `"assemble"`.
- **Verified by experiment** (`child-run.sh`, `child-run.out.txt`). One plain bundle of `driver.ts` with a source map, run once in `node` over the corpus's 17 `assemble` cases, with `NODE_V8_COVERAGE` and a scratch `HOME` under `/tmp`. 4.5 s wall, 4.2 s CPU, host load 30. 17 cases, no error. All 16 counted functions mapped back to `assemble.ts` with calls > 0: `assemble` 17, `relist` 3, `storeObserved` 9, `readBack` 9, `keysOf` 30, and so on.

### Q2. Each loader at the coordinator's current key (`store-read.out.txt`)

| Test file | Results at key | Record | `assemble.ts` in record |
|---|---|---|---|
| `test/keys/key-format.test.ts` | 13 pass, revision 251 | 25 KB, 285 sources | blob `6f9abf9`, 9 V8 functions, 0 ran |
| `test/keys/validity/adapters.test.ts` | 7 pass, revision 251 | 285 sources | same |
| `test/keys/validity/compare.test.ts` | 14 pass, revision 251 | stored 0.7 s after its results | same |
| `test/keys/validity/pytest.test.ts` | 5 pass, revision 250 (worktree `1759…`, adopted) | 285 sources | same |
| `test/keys/validity/reach.test.ts` | 7 pass, revision 250 (adopted) | 285 sources | same |
| `test/keys/validity/lock.test.ts` | 5 pass, revision 250 (adopted) | 51 sources | no entry |
| `test/version-sensitive.test.ts` | 7 pass, revision 239 (adopted) | 1 source | no entry |

`pending` is null for every row. The two "no entry" loaders hold `assemble.ts` in their closure but never load it in-process. `fileCondition` passes over them ("a loader whose record holds no entry for the source ran none of it").

The loader list comes from the main store's `test_files.closure_paths`. The daemon reads its own worktree's closure index (`loaders.ts`), which this probe cannot read. The verdict does not depend on that difference: all 5 records that hold the source agree.

### Q3. Why D9 judged `fail`

- **The loader conditions** (read in source code, `loaders.ts` `conditionAt`). Each loader's key equals the closure's key. No row is queued. Its results are present, with no `skip`, so the cause `skipped` does not apply. `coverage.storedAt` is not null, so each loader is `ready`. `file.ts` `fileCondition` finds no `unknown` cause and no `pending` loader, so the source is `ready`.
- **The bytes** (read in source code, `file.ts` `coverageOf`). Each record's entry is at blob `6f9abf9`, and `files.blob` and `git rev-parse HEAD:…assemble.ts` give the same blob. No record lists it as `unread`. So the result is not `"unread"`.
- **The join** (read in source code, `join.ts`). Nine V8 functions join the nine top-level counted functions by end position, and each has hit 0, so each gets `ran: false`. The seven nested functions (`assemble.<transaction>`, `keyed.<bootstrap>`, `moving.hash` and others) have no V8 entry: V8 never compiled them. `enclosing` finds their holder at hit 0, so they get `false` as well. With `ran: false`, coverage is 0, and CRAP = CC² + CC: `assemble` 17² + 17 = 306, `storeObserved` 110, `readBack` 42, `relist` 42 (store read, all match).
- **When** (store read). `relist` went `first-seen-fail` on both measures at revision 251, at 1792957917085. That is 1 s after the last loader's record (`compare.test.ts`, 1792957916115). The judgement waited for the whole record set, as D9 requires. Spec 015 D9's "false failure" is a judgement made before the records are in. That did not happen here. The 015-57 early pass does not apply: no record in hand shows a function run.

### Q4. Other sources with the same cause

**The same cause:** a source in the validity driver's bundle, loaded in-process with no function called, and run in the driver child. This was measured in the coordinator worktree (store read and an esbuild metafile of `driver.ts`, 245 inputs):

- **153 of 158** functions in the bundle's 14 `test/keys/validity/` files read `uncovered` `fail`. 15 of them also read `crap` `fail`: `vitestCase` 462, `assemble` 306, `pytestCase` 306, `named` 240, `recorded` 182, `runCase`, `writeAccept`, `decideAccept` and `storeObserved` 110, `write` 56, and five at 42.
- **On the host.** Four other worktrees whose states are judged read 152–153 `fail` on the same 14 files: `605ca21e`, `cc9bf3f8`, `b528f9fc` and this one. Seven more read them `pending`.
- **16 `src/` functions** in the bundle also read `fail` (`src/runners/node-test/**`, `src/runners/pytest/**`, `src/core/scheduler/lockfiles.ts`). Other tests load those files in-process. Whether the child alone runs these 16 is not determined: the probe ran only the `assemble` cases. Most of them are probably among R3's 377 (inferred, not matched function by function).

**Related, not the same cause:**

- **40 functions** in `harness/accept-rule-ledger.ts`, `store-traced.ts` and `barrier-scheduler.ts`. `bundle.ts` `BEFORE_MOVES` reads these files only for a tree that predates a move. The last release, `squeal--v0.1.321`, already has `src/core/scheduler/accept.ts` and `store-decision.ts`, and `barredByTouch` in `stability.ts`. So these 40 functions run in no process now. For them, "no test runs it" is plainly true, and the files can be removed ("each goes once the last release carries the move").
- **12 functions** in `test/keys/validity/python/squeal_validity_trace.py` run only in the Python child.

**For scale** (store read, coordinator worktree): 2,063 functions in 354 files read `uncovered` `fail`. Of those, 584 in 136 files are loaded in-process with no function called (this harness is 153 of them). 1,403 in 176 files are in a closure but never loaded in-process: `test/e2e` 581, `test/fixtures` 294, `src/runners` 138, `evals/bin` 110. 76 in 42 files have no loader. R3's 377 counted `src/` only. The `test/` share was never measured before.

## Recommendation for Squeal

1. **Not a 015 defect in the pending rule or the join.** The judgement waited for all seven loaders and read current bytes. The line says what D9 measures. No repair row is needed for correctness.
2. **015 owns a wording follow-up (D9 "Delivery").** Make the line say what the records show. Here, each record shows that the module's top-level lines ran and that no function ran, and each in-process loader's closure holds `sides.ts`, which imports `node:child_process`. An example: `relist (…/assemble.ts:150) no in-process test reaches it: 5 test files load the file but call none of its functions in their own process; they start child processes, which Squeal does not measure.` It keeps `fail` and adds no `unknown` (R3 Q3 rules out `unknown` from static reach), and it costs a read of data Squeal already has. The signal is file-level. R3 measured that signal at 100% recall and 10% precision, so the line must say "may", never "does".
3. **Whether this repository should stop judging these 14 files is a product question, not repo-local.** `complexity.exclude` is the only knob. It would drop their complexity too, and 015 has no coverage-only exclude. A `coverage.exclude` key would change D1, so it is for the human to decide.
4. **For `/quality`, not 015:** remove the three `BEFORE_MOVES` harness files and the two `ENTRIES_BEFORE_MOVES` entries. The last release carries every move, so those 40 functions are dead.

## Open questions

1. Whether the 16 `src/` functions in the bundle run only in the child. A probe over every case kind with the bundle's source map would decide it. That probe runs the whole corpus, pytest on two Pythons among it, so it was not run here (no CPU load).
2. How often an agent edits a child-only `test/` function. Over the last commits, `test/keys/validity/**` changed in 016-24 and 011-204 at least. The rate is not counted.
3. The daemon's own closure index can differ from `test_files.closure_paths`. The verdict holds either way, but the loader count of 7 is from the main store.

## Sources

- Probes: `probes/validity-harness-uncovered/store-read.mjs` → `store-read.out.txt`; `child-run.sh` and `map-child.mjs` → `child-run.out.txt`. The bundle and the scratch were deleted.
- Stores (read-only): `/home/agent/projects/squeal/.git/squeal/store.sqlite` (`worktrees`, `revisions`, `test_files`, `test_file_keys`, `results`, `checks`); `/home/agent/projects/squeal/.git/squeal/code.sqlite` (`files`, `checks`, `states`, `transitions`, `coverage`).
- Code at `20a6be623`: `src/core/code/crap/{loaders,file,join}.ts`, `src/core/code/coverage/{record,types}.ts`, `test/keys/validity/{driver,harness,bundle,sides,coverage,trees}.ts`, `test/keys/validity/harness/assemble.ts`, the four `*.test.ts` files that import `./driver.js`.
- Spec 015 D8, D9 and Non-goals; `research/child-processes.md` (R3).
