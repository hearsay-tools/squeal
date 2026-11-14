# Loaded-module probes: node:test and pytest (throwaway)

Throwaway scripts for the 022 research question "can Squeal key a node:test or
pytest file on the modules its last run loaded?". Nothing here is product code
and nothing imports it. Results are in `results.md`.

Run everything from a scratch directory, never from the repo, with `HOME` set
to a scratch home. Versions used: Node v26.13.0; pytest 9.2.0 on Python
3.11.15 (a `uv venv` in scratch; `uv` picked its managed 3.11, not the system
3.12.3). `W` below is the worktree root, `P` this directory, `S` a scratch dir.

## node/

| file | what it does |
|---|---|
| `make-capability-fixture.sh <dir>` | Fixture with ESM, CJS, type-stripped `.ts`, a dynamic import, a worker thread, a child process, a data file, `require("./foo")` resolving to `foo/index.js`, and a module two test files share. |
| `hook-sync.mjs` | `--import` preload: `module.registerHooks` resolve + load hooks, one NDJSON line per new edge to `$LM_OUT/<pid>-<threadId>.ndjson` (append per edge, as Squeal's recorder does). |
| `hook-sync-memory.mjs` | Same, resolve only, kept in memory, one write at exit. |
| `hook-async.mjs`, `hook-async-worker.mjs` | `module.register` async loader hooks (hooks thread), resolve + load. |
| `dump-exit.cjs` | At exit writes `require.cache` keys and file-like `process.moduleLoadList` entries. |
| `summarize.mjs <out> <fixture>`, `summarize-cov.mjs <out> <fixture>` | Per process/thread, the fixture files each method saw. |
| `cjs-cache-probe.mjs <fixture>` | Does the sync resolve hook see a `require()` of an already-loaded CJS module from a sibling file, another directory, the same file; and a cached ESM import? |
| `make-cost-fixture.mjs <dir> [N]` | N-module tree (module i imports 2i+1, 2i+2; `.mjs`/`.cjs`/`.ts` by i % 3) and one test file importing the root. |
| `time-cost.mjs <fixture> <P/node> <W/src/runners/node-test/runtime/recorder.cjs> [reps]` | Times `node --test t.test.mjs` per variant, interleaved; skips a round while 1-min load > 24. |
| `shadow-demo.sh <fixture> <P/node> <out>` | A new `foo.js` changes what `require("./foo")` loads. |

```sh
export HOME=$S/home
sh $P/node/make-capability-fixture.sh $S/fx1 && cd $S/fx1
LM_OUT=$S/o NODE_OPTIONS="--import $P/node/hook-sync.mjs --require $P/node/dump-exit.cjs" \
  node --test --test-isolation=process a.test.mjs b.test.mjs   # or =none
node $P/node/summarize.mjs $S/o $S/fx1
NODE_V8_COVERAGE=$S/c node --test a.test.mjs b.test.mjs && node $P/node/summarize-cov.mjs $S/c $S/fx1
node $P/node/make-cost-fixture.mjs $S/cost 300
node $P/node/time-cost.mjs $S/cost $P/node $W/src/runners/node-test/runtime/recorder.cjs 10
```

## pytest/

| file | what it does |
|---|---|
| `make-fixture.sh <dir>` | Two test files sharing `pkg.shared` (imports `pkg.deep`), `pkg.only_b` for test_b, a function-level import `pkg.lazy_dep` that only test_a calls, a root `conftest.py` importing `helpers`, a data file. |
| `lm_attrib.py` | Plugin (`-p lm_attrib`, `LM_ROOT`, `LM_OUT`): attributes project modules per test file three ways in one process: `sys.modules` difference, a `sys.meta_path` finder, importer edges + reachability. |
| `squeal_reach.py <events> <root> <test>...` | Reach per test file over the `import` events of Squeal's own `squeal_pytest.py`, as `observeBatch` does. |
| `shadow-demo.sh <dir> <python> <W/src/runners/pytest/runtime> <P/pytest>` | A new `tests/util.py` shadowing `lib/util.py`, and a new `nsx/__init__.py`. |
| `time_cost.py <dir> <python> <W/src/runners/pytest/runtime> <P/pytest> [reps]` | 300-module package tree; times plain pytest, Squeal's plugin, `lm_attrib`. Bytecode goes to `<dir>/.pycache`. |

```sh
export HOME=$S/home PYTHONPYCACHEPREFIX=$S/pycache
uv venv $S/venv && uv pip install --python $S/venv pytest
sh $P/pytest/make-fixture.sh $S/pyfx && cd $S/pyfx
LM_ROOT=$PWD LM_OUT=$S/a.json PYTHONPATH=$P/pytest $S/venv/bin/python -m pytest -q -p lm_attrib tests/test_a.py tests/test_b.py
SQUEAL_PYTEST_ROOT=$PWD SQUEAL_PYTEST_EVENTS=$S/ev.jsonl PYTHONPATH=$W/src/runners/pytest/runtime \
  $S/venv/bin/python -m pytest -q -p squeal_pytest tests/test_a.py tests/test_b.py
python3 $P/pytest/squeal_reach.py $S/ev.jsonl $PWD tests/test_a.py tests/test_b.py
```

Set `PYTHONPYCACHEPREFIX` (or `PYTHONDONTWRITEBYTECODE=1`) whenever `PYTHONPATH` points into
the worktree, or Python writes `__pycache__/` into `src/runners/pytest/runtime/`.
