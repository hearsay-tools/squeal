# Results: loaded-module recording for node:test and pytest

Run 2026-11-14 on Node v26.13.0 and pytest 9.2.0 / Python 3.11.15, Squeal at
2856d26e8. Scripts and re-run steps are in `README.md`. Tags: **exp** = verified by
experiment here, **src** = read in source at 2856d26e8, **docs** = official docs,
**inf** = inferred.

## 1. What Squeal already does

| fact | tag |
|---|---|
| node:test runs one `node --test <file>` process per test file; the per-file argv ends in one `arg` | src `src/runners/node-test/run/run.ts:98-114, 133-145` |
| That process loads Squeal's recorder first (`--require`, and in `NODE_OPTIONS` so children load it too) | src `run.ts:136-140, 304-313` |
| The recorder already records every resolved import/require as `{parent,url,specifier}` per process, using a sync `module.registerHooks` resolve hook, to `graph-<i>-<pid>.ndjson` | src `src/runners/node-test/runtime/recorder.cjs:7-11, 88-114` |
| `observedClosure` turns those edges into the loaded set per test file (`paths`), separates preload loads (`preloadPaths`) and what spawned processes loaded (`direct`) | src `src/runners/node-test/run/observed.ts:15-28, 60-87` |
| The adapter reports it as `RunReport.observed`; the core keeps it as paths "beyond its static closure", merged and never pruned, so today it only adds to the static closure | src `src/runners/node-test/adapter-project.ts:179-180, 193-218`; `src/core/keys/observed.ts:11-20` |
| The shared observe recorder (Vitest workers, node:test warm-ups) records module loads as `f` + `m` (+ `d` in a started process); `ObservedInputs.modules` carries the `m` set | src `src/runners/observe/recorder.cjs:29-36, 199-204, 225-251`; `src/runners/observe/inputs.ts:60-68`; `src/core/types/runner.ts:453-454`; stored by `ModuleSets` `src/core/keys/modules.ts:6-27` |
| node:test coverage (`NODE_V8_COVERAGE`) is per test file: one directory per file index, and the recorder keeps only the file's own pid | src `run.ts:146-147, 222-224`; `recorder.cjs:34-46, 61-74` |
| Coverage is off for a project with `--test-isolation=none`, but each file still gets its own `node --test` process | src `src/runners/node-test/coverage.ts:24-28, 45-49`; `run.ts:133-145` |
| pytest runs files in batches, 5 per process by default; slow/group files alone | src `src/runners/pytest/run/run.ts:43-46, 71`; `run/batches.ts:35-55`; `adapter-run.ts:63-66` |
| Squeal's pytest plugin wraps `builtins.__import__` and `importlib.import_module` and writes an `(importer, imported)` edge for every import statement, cached ones too, with the file in progress as `ctx` | src `src/runners/pytest/runtime/squeal_pytest.py:22-32, 110-195` |
| `observeBatch` attributes by reachability from the test file plus the conftests above it over the whole batch's edges, so attribution does not depend on which file imported first | src `src/runners/pytest/run/observed.ts:32-106` |
| Processes a test starts record through `sitecustomize.py` (a `sys.meta_path` finder) under `SQUEAL_PYTEST_FILE` | src `src/runners/pytest/runtime/sitecustomize.py:1-60`; `squeal_pytest.py:81-89` |

## 2. node:test recording methods (capability fixture)

What each method attributed, per process (P = test file process; W = worker thread; C = child process).

| method | CJS | ESM | `.ts` (native strip) | dyn `import()` | worker thread | child process | `--test-isolation=none` | tag |
|---|---|---|---|---|---|---|---|---|
| sync `module.registerHooks` resolve/load via `--import` in `NODE_OPTIONS` | yes | yes | yes | yes | yes, own file (thread 1) | yes, own pid file | one process: a.test + b.test sets merged | exp |
| async `module.register` (hooks thread) | only CJS loaded by `import`; misses every `require()` (`cjs-dep`, `cjs-leaf`, `shared-leaf`, `foo/index.js`) | yes | yes | yes | yes, but in the main pid's file | yes | (not run) | exp |
| `require.cache` at exit | yes | no (ESM and `.ts` loaded as ESM absent) | no | no | its own, empty | its own | merged | exp |
| `process.moduleLoadList` | no project files at all | no | no | no | - | - | - | exp |
| `NODE_V8_COVERAGE` script list | yes | yes | yes (`.ts` URL) | yes | yes, own file | yes, own file | merged | exp |

Edges in one shared process (`--test-isolation=none`, a then b): b gets edges `b→shared.cjs`, `b→esm-dep.mjs`
(each ESM importer resolves its own specifiers), but **no** edge for b's `require("./cjs-dep.cjs")`, already
loaded by a. `cjs-cache-probe.mjs` shows why: **exp**

| call | resolve hook fired |
|---|---|
| first `require("./cjs-dep.cjs")` from `a.test.mjs` | yes (+ its child) |
| same request from sibling `b.test.mjs`, same directory, cached | **no** (Node's relative-resolve cache is keyed by the parent's directory + request) |
| `require("../cjs-dep.cjs")` from `foo/x.js`, cached | yes |
| same file again | no |
| `import()` of a cached ESM module from a new parent | yes, the edge only (no re-resolve of its children) |

So in one process, edge reachability over-attributes nothing but can drop a CJS edge from a second file
in the same directory; with one file per process (Squeal today) that does not arise across test files.

### Cost (`node --test t.test.mjs`, interleaved rounds, `NODE_OPTIONS` preload)

300 modules (100 `.mjs`, 100 `.cjs`, 100 `.ts`), 10 rounds, 1-min load 13.3-14.8: **exp**

| variant | median ms | min | max | vs base |
|---|---|---|---|---|
| base | 264 | 235 | 478 | 0% |
| Squeal's recorder.cjs (`--require`, append per edge) | 279 | 260 | 442 | +6% (+15 ms) |
| sync hook resolve+load, append per edge | 285 | 265 | 422 | +8% (+21 ms) |
| sync hook resolve only, in memory, one write at exit | 257 | 239 | 416 | -3% (noise) |
| async `module.register` resolve+load | 395 | 367 | 624 | +50% (+131 ms) |
| `NODE_V8_COVERAGE` | 291 | 275 | 581 | +10% (+27 ms) |

1500 modules, 6 rounds, 1-min load 12.6-14.0: **exp**

| variant | median ms | min | max | vs base |
|---|---|---|---|---|
| base | 532 | 500 | 571 | 0% |
| Squeal's recorder.cjs | 617 | 540 | 775 | +16% (+85 ms) |
| sync hook resolve+load, append per edge | 612 | 588 | 784 | +15% (+80 ms) |
| sync hook resolve only, in memory, write at exit | 540 | 517 | 695 | +2% (+8 ms) |
| async `module.register` | 921 | 854 | 1245 | +73% (+389 ms) |
| `NODE_V8_COVERAGE` | 621 | 555 | 671 | +17% (+89 ms) |

Read: the per-edge `appendFileSync` costs about 0.05 ms per module; the hook itself is near free. Spread
between rounds is ±20-50 ms, so differences under ~20 ms at 300 modules are noise.

## 3. pytest: attribution in one process (`pyfx`, Squeal-free plugin `lm_attrib.py` and Squeal's own plugin)

Order a, b:

| file | `sys.modules` diff | `meta_path` finder (first import) | importer edges + reach (lm_attrib) | Squeal plugin + `observeBatch` reach |
|---|---|---|---|---|
| test_a | pkg/__init__ deep lazy_dep shared | same | conftest helpers pkg/__init__ deep lazy_dep shared | same + test_a |
| test_b | **only_b** | **only_b** | conftest helpers pkg/__init__ deep lazy_dep only_b shared | same + test_b |

Order b, a:

| file | `sys.modules` diff | `meta_path` | edges | Squeal plugin |
|---|---|---|---|---|
| test_a | **lazy_dep** | **lazy_dep** | conftest helpers pkg/__init__ deep lazy_dep shared | same |
| test_b | pkg/__init__ deep only_b shared | same | conftest helpers pkg/__init__ deep lazy_dep only_b shared | same |

**exp**: the first-import methods depend on order and give the second file almost nothing; neither
attributes the root `conftest.py` or what it imports (`helpers`) to any file, since pytest imports it
before any file's collection. Edge reach is order-independent and roots conftests, but over-attributes:
test_b gets `pkg/lazy_dep.py` because `shared.py → lazy_dep` was recorded while test_a ran (a
function-level import), which is safe (one extra re-run), not a miss.

An under-attribution no import hook sees (**exp**): `test_c.py` does `import pkg` and reads `pkg.deep.D`
(empty `pkg/__init__.py`). Run after test_a in one process it passes; its reach is `conftest helpers
pkg/__init__ test_c`, without `pkg/deep.py`; run alone it fails. Its result depends on `deep.py` and
on batch order, and neither a loaded set nor the static closure holds `deep.py`.

Sound options in one process (**inf** unless tagged):

- importer edges recorded at every import statement (cached too) plus reachability from the test file and
  its conftests: what Squeal already does (src, above). Over-attributes lazy imports reached by any file;
  misses attribute access to submodules another file imported (exp, test_c) and loads outside
  `__import__`/`import_module` (`spec_from_file_location` + `exec_module`, `runpy`, `exec`).
- whole-batch union as every file's set: sound for import-order effects such as test_c, but with batches
  of 5 every file re-runs when any batch-mate's module changes; and batches vary between runs.
- one process per file (batch size 1, `-p xdist` with `--forked`, or `pytest-forked`): then `sys.modules`
  diff or a finder is exact per file, at pytest start-up cost per file (~240 ms base here).
- conftest.py: every file below a loaded conftest gets it and its imports (Squeal does this by rooting
  them, `observed.ts:93-98`).

pytest-testmon 2.3.0 (latest on PyPI, wheel files dated 2026-11-02; source read from the wheel): one Coverage.py instance with a
dynamic context per test, `cov.switch_context(test_name)` in `start_testmon` (`testmon/testmon_core.py:555-565`),
called per item from `pytest_runtest_protocol` (`testmon/pytest_testmon.py:397`). Lines run with no
context, which includes import-time execution during collection, are dropped
(`testmon_core.py:629`, `nodes_files_lines.pop("", None)`). A test depends on the blocks (function
bodies, plus the module-level block, which spans the whole file) holding a line it ran
(`testmon/process_code.py:136-213, 298-313`). So testmon attributes executed lines per test, order-free in
one process, but (**inf**) a module whose code only ran at import (a constants module read as an attribute)
is not a dependency of the test that reads it. Its docs say it tracks project code, env vars, Python
version and package versions, and not "static files (txt, xml, other project assets)" or external services
(docs: https://www.testmon.org/, fetched 2026-11-14; version 2.3.0 per https://pypi.org/pypi/pytest-testmon/json).
xdist is supported (`pytest_testmon.py:253-254`); subprocess coverage via a coverage rc (`testmon_core.py:545-546, 654-673`).

### Cost (300-module package tree, one test file, 10 interleaved rounds, 1-min load 11.2-11.5) **exp**

| variant | median ms | min | max | vs base |
|---|---|---|---|---|
| plain pytest | 243 | 219 | 279 | 0% |
| Squeal's `squeal_pytest` plugin (edges) | 272 | 263 | 321 | +12% (+29 ms) |
| `lm_attrib` (unoptimised probe, three methods at once) | 1035 | 983 | 1117 | +327% |

An earlier run at load 10.7-11.0 gave 232 / 264 (+14%) / 1004. `lm_attrib` is a naive probe (uncached
`realpath` per import, a meta_path finder that re-walks `sys.meta_path`); its cost says nothing about the
methods.

## 4. What a loaded set misses

| input | node:test | pytest | tag |
|---|---|---|---|
| data file read with `fs`/`open` | `data.json` read with `readFileSync` is in no hook set | `data.txt` in no attribution set | exp |
| a new file that changes resolution | `require("./foo")` loads `foo/index.js`; add `foo.js` and it loads `foo.js`; no file of the old set changed | new `tests/util.py` shadows `lib/util.py` (prepend import mode puts `tests/` first): set was `lib/util.py nsx/mod.py test_s`, test then fails | exp (`node/shadow-demo.sh`, `pytest/shadow-demo.sh`) |
| a new `__init__.py` | - | new `nsx/__init__.py` turns namespace `nsx` regular; its code now runs; old set had no `nsx/__init__.py` (namespace packages have no file) | exp |
| what Squeal's static graph does for those | an add or delete re-resolves the whole graph (`node-test/graph/graph.ts:87-95`); absent candidates kept only for unresolved specifiers (`resolver.ts:17-18, 251-255`) | resolver keeps absent candidates of every lookup (`pytest/graph/resolver.ts:15-30`) | src |
| failed resolves | Squeal's observe recorder records the absent path a failed relative/`file:` resolve names (`observe/recorder.cjs:229-241`); the node-test recorder does not | - | src |
| child processes | seen only when the hook is in `NODE_OPTIONS` (as Squeal puts it) | seen only through `sitecustomize` (as Squeal does) | exp / src |
| env vars, argv, network, clock | not modules | not modules; testmon tracks env vars only as a run variant | inf / docs |
| attribute access to a submodule another file imported in the same process | - (one file per process) | test_c above | exp |
