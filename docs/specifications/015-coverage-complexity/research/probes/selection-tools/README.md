# Selection tools probes

Throwaway research for 015-96. These scripts create isolated temporary fixtures. They do not open a Squeal store, change product configuration, or run the repository suite. The scripts read product source at `d6d75dbe63ee60ec072af547a1d08911f6678a09`. Run from that checkout with its installed pnpm dependencies. Outputs are evidence, not a selector supported by Squeal.

## Reproduce

Use a scratch directory for the external sources and Python environments. Do not install these packages into the project.

```sh
probe=docs/specifications/015-coverage-complexity/research/probes/selection-tools
scratch=$(mktemp -d)
git clone https://github.com/tarpas/pytest-testmon "$scratch/testmon"
git -C "$scratch/testmon" checkout 94150742345d0bc3fb00a10c19c0ae26a0064c4e
python3 -m venv "$scratch/stable"
"$scratch/stable/bin/pip" install pytest-testmon==2.2.0 pytest==9.0.2 coverage==7.13.1
python3 -m venv "$scratch/beta"
"$scratch/beta/bin/pip" install "$scratch/testmon" pytest==9.0.2 coverage==7.13.1
"$scratch/stable/bin/python" "$probe/testmon_probe.py" "$probe/stable"
"$scratch/beta/bin/python" "$probe/testmon_probe.py" "$probe/current"
node "$probe/js-probe.mjs" "$probe/current"
pnpm exec tsx "$probe/warm-vitest.mjs" "$probe/current"
python3 "$probe/audit.py"
python3 "$probe/audit.py" --check
python3 "$probe/sources.py" "$probe/sources.json"
```

`current/testmon-results.json` means the pinned **beta source**, not a newer stable release. Both Python arms use Python 3.12.3, pytest 9.0.2 and coverage.py 7.13.1. Each fixture starts with a fresh passing baseline. The selected run uses the actual plugin. The exhaustive oracle uses plain pytest with third-party plugin autoload disabled. Full output and per-test/collection errors are saved. A collection failure is not counted as an executed test case. These are bounded fixture suites, not repository suites.

`stable-cacheprovider-failure.txt` preserves an initial command failure: 2.2.0 accesses `options['lf']` when `-p no:cacheprovider` removed it. The final comparison leaves pytest's cache provider enabled in **both** arms; cache files stay in the temporary fixture. Beta's `configure.py` uses `.get('lf')`. This is an integration compatibility finding, not a selection miss. Squeal's current pytest command redirects the cache rather than disabling its provider.

The upstream structural tests can be fetched at the stable source commit:

```sh
curl -fsSL https://raw.githubusercontent.com/tarpas/pytest-testmon/dccc58d2ed8edec98096ff1974acb7c07d3e3482/tests/test_process_code.py -o "$scratch/test_process_code.py"
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$scratch/stable/bin/python" -m pytest -q "$scratch/test_process_code.py::TestCreateAndMatchFingerprintRoundtrip" "$scratch/test_process_code.py::TestCodeToBlocks"
```

That targeted run passed 19 tests. Running the entire downloaded file first gave 30 passes and two failures because the pinned repository omits `tests/samples/empty.py` and `no_newline_eof.py`; both outputs are saved. No upstream full-suite pass is claimed.

## JavaScript method and detector boundaries

`structural.mjs` parses a complete module with Acorn. It keeps top-level function signatures and all module-level code in a structural fingerprint. It hashes each top-level function's complete body separately. A body edit selects any test file that executed that function. Missing ranges, parse errors, changed structure or absent evidence select conservatively. Nested functions remain inside the enclosing body's fingerprint; classes and arrows are not narrowed. This independent implementation uses SHA-256, not Testmon's CRC32. It is a function-block method, not a line-hunk method.

`js-probe.mjs` compares three selectors with isolated-process exhaustive outcomes:

1. `raw`: source structure and function execution only.
2. `guarded`: actual observed calls through wrappers for `readFileSync`, `execFileSync` and this realm's `Function.prototype.toString`, plus input/epoch checks. These wrappers are research instrumentation, **not shipped Squeal detectors**. `spawnSync`, descriptor reads, other-realm reflection and raw source reads expose their limits. A module loader itself reads source bytes, so recording a source read is not sufficient to distinguish a test inspecting that source.
3. `existing`: the same structural method using the actual `src/runners/observe/recorder.cjs` output, including `f` input paths and `d` child module paths. No fixture hazard labels drive this selector. Reflection and raw source inspection still escape it. Existing observations are not a complete-effects certificate.

Fields that intentionally corrupt a source hash or provider epoch generate stale-evidence inputs; the selector compares hashes/tags without reading the fixture label. The epoch is a simulated provider generation, **not an implementation of Squeal's full environment key**. `env` deliberately changes an unkeyed variable. File membership and source snapshots are known in these fixtures; arbitrary dynamic resolution, package changes and out-of-scope reads are not solved.

The `.mjs` cases run Node 24.22.1. Three additional cases use real esbuild 0.28.2 TypeScript transformation before V8 measurement; they compare generated JS, not source-map correctness. The cold fixture includes explicit CPU work to make file execution measurable. Its timing is not a realistic warm-Vitest estimate. `timed_node.py` measures CPU of each Node process and waited descendants via `RUSAGE_CHILDREN`, excluding Python timer startup. Wall timings include a separately named outer orchestration measure. Five body-refactor samples report medians; they are not a population estimate.

## Real warm Vitest

`warm-vitest.mjs` uses installed Vitest 5.0.3, the **actual Squeal coverage provider and mapper**, the actual runtime-input recorder, and Vite's transitive import graph. It does not use the research reflection wrapper. Each arm has its own persistent Vitest instance with at most one thread worker, isolation on, a cold run, and an unchanged baseline run before the edit. Worker IDs show that Vitest replaces the isolated thread for each file. The instance and transform cache are warm; no continuously resident test worker is claimed. Disabling isolation would make this Squeal provider omit per-file coverage. The fixture has eight test files with three cases each; hazard cases add one file and one case. There is no busy loop, sleep or synthetic test delay in this fixture.

The selected arm takes provider payloads per file and maps V8 ranges through the executed Vite transform using `mapScript`. Full function-span matches feed the structural selector; absent matches fall back. The exhaustive arm has coverage off. Both arms use the recorder. Source changes explicitly invalidate Vite's cache. Reporter events, not Vitest's cumulative state, identify the files and test cases that actually ran. The mapper captures new records after selected edits too; those costs are included. The prototype holds bytes fixed during each run; concurrent edit/source-stamp acceptance remains untested.

The initial draft omitted Vite's static import closure and missed the separate gate-module edit. `warm-initial-notes.txt` preserves that initial finding. The final probe adds actual `moduleGraph.importedModules` paths to the inputs, as Squeal's existing closure does. It does not add a fixture-specific gate flag.

`current/warm-results.json` preserves startup, cold run, warm baseline, decision, edited run, mapped function spans, transform hash, runtime observations, module diagnostics, requested files, actual case results and worker IDs. `collectDuration` is Vitest's per-module collection diagnostic, not total execution time. `executionWallMs` includes Vitest's run and provider payload production; `captureWallMs` includes reading/mapping and observation processing. Their sum is `totalWallMs`; decision time is separate. Linux `/proc` process-tree CPU sums process/thread CPU, live descendant CPU and waited child CPU at each boundary, with the recorded `CLK_TCK` resolution. It includes collection, transformation, coverage, mapping and child processes. Load is recorded per tier. Arm order alternates across cases. Five equivalent ordinary refactors provide timing samples. These fixtures establish neither repository-wide savings nor a sound arbitrary-edit selector.

## Interpretation

A failure missed by a selector remains a failure in the exhaustive oracle. It is never relabelled a pass. A successful narrow run does not prove that the omitted tests pass at a new whole-file key. The proposed skip-and-stale policy would suppress those background runs while retaining old evidence and validation debt. It must not promote old rows to current or discharge a full-suite checkpoint.

The fixtures do not measure existing same-key cache hits or cross-worktree sharing. Those can already avoid runs without this selector. No full repository run, Wallaby activation, paid service, upload or live-store/config change occurred. Source URLs, fetched hashes and pins are in `sources.json`; the Wallaby package listing and tarball hash are in `wallaby-package.json` (downloaded for inspection, never installed or executed).

The final warm run has 18 cases. The two added independent-function cases were appended with `pnpm exec tsx "$probe/warm-vitest.mjs" "$probe/current" independent-tax-refactor independent-label-regression`; running without names reproduces all 18. The initial log is diagnostic history only; use `current/warm-results.json` and `summary.json` for final counts and timing.

## Source trace and integration costs

The fetched Testmon head (`94150742`, version 2.3.0b0) and Stryker head (`c48089a6`, packages 10.1.1) both have commit dates 2026-10-27. This is evidence of current activity, not a passing CI or reliability claim. Testmon stable 2.2.0 requires Python >=3.10, pytest >=5,<10 and coverage >=6,<8. Beta raises the Python floor to 3.11 and pytest floor to 7. Stryker's examined Vitest package requires Node >=22, its core/api/util packages and Vitest >=2; development uses Vitest 4.1.12. Its source includes planner tests for static/global selection; those tests were read, not run.

Testmon's Python algorithm was traced before prototype construction, in this order: `pytest_testmon.init_testmon_data` -> `TestmonData.determine_stable` -> changed file hashes -> `Module.blocks`/`method_checksums` -> `DB.determine_tests`/`check_fingerprint_db` -> `TestmonSelect` collection and case deselection. Capture flows through `TestmonCollector.switch_context`/`get_nodes_files_lines` -> `create_fingerprint` -> saved dependencies and outcomes. The structural module implementation is byte-identical between the two examined versions. Signature fingerprints can exist without being attached to every observing test; the metadata-only fixture imports an already-loaded module inside its test and misses the arity change. It is not evidence that the parser ignores signatures.

A Testmon adapter needs more than `--testmon` on Squeal's command. It must negotiate the project's installed plugin, prevent plugin deselection from masquerading as a complete file result, collect and translate test IDs, preserve ordinary failed-test reruns, distinguish no selection from collection failure, and manage DB writes with per-project/worktree environment isolation. Neither its SQLite schema nor its internal Python classes are a versioned selection API. Squeal's static imports and declared inputs remain necessary, and Python's present recorder does not supply general file reads. Package patch normalization in Testmon cannot replace Squeal's installed-dependency/environment hash. The `--testmon-noselect`/`--testmon-nocollect` modes can separate data collection from selection, but are not themselves an integration implementation.

The JS prototype imports Acorn already present in Squeal and the product's provider/mapper/recorder directly. A shipped implementation still needs an adapter-owned eligibility/evidence protocol; core should decide queueing and validity, not import runner internals. C7 store sharing would require versioned evidence provenance and retention, not sharing Testmon's SQLite file as Squeal's result store. No new dependency or shared-store schema is proposed as landed work.

## Completion checks

`python3 audit.py --check` passes, including actual selected/exhaustive warm case outcomes and the saved summary. `node --check` passes for all five `.mjs` files; Python AST parsing passes for all four `.py` files. These research paths select no repository tests: the saved absolute Squeal `status --wait 60000` command returned no verdict (exit 3), known failures 0, 35 unknown files elsewhere in the worktree. This is not a repository test pass. No build, typecheck or full suite was run for the research-only change.
