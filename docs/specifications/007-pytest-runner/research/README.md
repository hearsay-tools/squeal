# Research brief for spec 007: pytest runner

Read `docs/vision.md` and `docs/styleguide.md` first. Then `../status.md` for the decisions already made, spec 001 sections D3 to D5 for the rules a runner must satisfy, and `src/core/types/runner.ts` for the interface. `../../003-node-test-runner/spec.md` and its `status.md` show how a runner without a warm instance or a module graph was built; read them before proposing anything they already solved. `../../001-core-loop/research/result-fingerprinting-prior-art.md` already read testmon's keys.

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Signal over completeness.
- Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions, Sources.
- Mark every finding as one of: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Name the Python and pytest versions you looked at; run experiments on Python 3.10 and 3.13 where behaviour could differ (`uv python install` fetches them into uv's own cache).
- Prefer experiments over reading when an experiment is cheap. Throwaway probes go under `research/probes/<topic>/` and must say they are throwaway in a README, with `.venv`, `__pycache__` and `.pytest_cache` ignored. No product code anywhere else.
- Probe environments are `uv venv` directories inside the probe folder. Never `pip install --user`, never install into the system Python, never touch `~/.config` or the real `HOME`. Run no third-party agent tooling.
- A fixture should look like a common pytest project: `pyproject.toml` with `[tool.pytest.ini_options]`, a `src/<pkg>` layout installed editable into `.venv` by uv, `tests/` with a root `conftest.py` and one nested `conftest.py`, a parametrized test, a fixture from an installed pytest plugin, and one second package for a monorepo case.
- Reference URLs and file paths. Do not paste large code; a few lines to prove a point is fine.
- Do not design Squeal. Answer the questions and recommend. The spec is written by the coordinator from these documents.
- Do not touch anything outside `docs/specifications/007-pytest-runner/research/`.

## Topic: pytest-runner-api

Squeal will run an explicit list of pytest files repeatedly from a Node daemon, read per-test results with locations, tell a collection error from a failing test, and honour the project's pytest configuration.

1. Driving pytest: a fresh `python -m pytest <files>` process per run against a long-lived Python worker that re-runs on request. For the worker, what goes stale between runs (`sys.modules`, conftest and plugin registration, fixtures with session scope, `importlib.reload` limits) and is a fork-per-run server (pre-imported plugins, fork per batch) sound? Measure interpreter start, pytest start and plugin load against one test's run time on the fixture.
2. Results: a small reporting plugin passed with `-p` (hooks `pytest_runtest_logreport`, `pytest_collectreport`, `pytest_sessionfinish`, `pytest_internalerror`) writing JSON lines, against `--junitxml` and `pytest-json-report`. Per-test outcome per phase (setup, call, teardown), duration, failure location (the test's line against the traceback's), skip, xfail, xpass, errors in fixtures. Which gives every case reliably, including a killed or hung run?
3. Collection without running: `--collect-only` cost and output; test identity from node IDs (parametrize IDs, generated IDs with objects, class nesting, `-k`-free stability across runs, duplicate IDs). A collection error in one file: does it stop the session, which flags change that, what does each report carry.
4. Configuration: rootdir and inifile discovery (`pyproject.toml`, `pytest.ini`, `tox.ini`, `setup.cfg`), `testpaths`, `python_files`, `addopts`, `-p no:` flags, `--import-mode` (prepend, append, importlib) and `pythonpath`. What must Squeal pass or strip (`-x`, `--lf`, `-n`, `--cov`, output capture) so `addopts` cannot break its runs? Should the adapter read the config, ask pytest, or take a declared entry in `squeal.config.json`, and what does each choice get wrong?
5. Parallelism: `pytest-xdist` against several pytest processes started by Squeal, one file per process or batches; cost and result fidelity of each on a 20-file fixture.
6. Timeouts and exit: a test that never ends (with and without `pytest-timeout`), exit codes 0 to 5 and what each means for Squeal, `KeyboardInterrupt` and `SIGTERM` handling, leftover child processes.
7. Sharp edges: async tests (`pytest-asyncio`, `anyio`), Django and its settings, doctests, `unittest.TestCase` classes, snapshot plugins (`syrupy`) and `--snapshot-update`, tests writing into the tree, `.pyc` writes into the worktree (`PYTHONDONTWRITEBYTECODE`, `-p no:cacheprovider`).

## Topic: python-module-graph

Spec 001 D3 keys a result by the hashes of every project file in its test file's closure, and D5 runs, per revision, only the test files whose closure holds a changed path, direct importers first. The key must be computable in a fresh worktree before any run, and the daemon runs on Node from a bundle with no native addons.

1. Static graph: parse imports (`import a.b`, `from . import x`, `from a import b` where `b` is a module or a name, imports under `if TYPE_CHECKING`, `try/except ImportError`, function-local imports, `importlib.import_module` and `__import__` with literals) and resolve them as the project's interpreter would: `sys.path` with the `src` layout, editable installs (`.pth` files and the newer import-hook editables), namespace packages, `__init__.py` of every parent package, relative imports, stub-only files. Compare at least two of: a Node-side parser (tree-sitter-python as WASM, a hand-rolled import scanner), the project's own Python running an `ast` helper, an existing tool (Pants' dependency inference, `pydeps`, `grimp`, `importlab`). Measure on a 1,000-module fixture. Name what each misses.
2. pytest's own inputs: `conftest.py` chains up to the rootdir, plugins loaded through `pytest_plugins`, entry points and `-p`, fixtures defined in plugins, data files read through `importlib.resources` or relative paths. Which belong in the test file's closure, which in the environment hash, as spec 001 D3 separates setup files?
3. Observed graph: record what a test file actually imported during a run (`sys.modules` diff per file in a reporting plugin, a `sys.meta_path` finder, `sys.addaudithook` import events, coverage.py). Cost, per-file separation in one process, and what imports at collection time against at run time.
4. Which graph the key uses: does goal 4 force the static closure into the key, with the observed closure as a completeness check, as spec 003 chose? How would a gap be reported (D3's `complete: false`)?
5. Resolution changes: an added module that shadows another, a new `__init__.py`, a changed `.pth` or `pyproject.toml`: is a full static re-resolve on 1,000 modules cheap enough to replace incremental rules? Measure.
6. testmon as a component, not only prior art (the human, 2026-10-13: "what we may use is testmon"). Can Squeal drive `pytest-testmon` itself, or read its `.testmondata` database, for `affected`, and what would it give and cost: coverage overhead per run against a plain run, selection quality on the fixture (verified by experiment), its stability across testmon versions, its licence, and where it conflicts with Squeal's rules: keys that need a run first (goal 4, fresh worktrees), one database per worktree against Squeal's shared store, data files and non-Python inputs it cannot see, `--testmon` changing which tests pytest collects. Name what a hybrid would look like: a static closure for keys, testmon's block data only to narrow `affected`.
7. Prior art, one paragraph each with what Squeal can reuse: Pants and Bazel's `rules_python` dependency inference, `pytest-picked`, `pytest-incremental`, Jest's `--findRelatedTests` for contrast.
8. Recommendation: the closure definition for a pytest file, the `affected` algorithm, their measured cost, how the key stays computable in a fresh worktree, and what the first fixture tests of a board row would assert.

## Topic: python-environments

Squeal must find the interpreter a project's tests run under, in every worktree, and key results by the environment. Spec 001 lesson defect 12 (a runner from another worktree's `node_modules`) is the failure to avoid.

1. Interpreter discovery: `.venv` in the worktree, uv (`uv run`, `uv.lock`, `UV_PROJECT_ENVIRONMENT`), Poetry, PDM, Hatch environments, conda, pyenv `.python-version`, a `VIRTUAL_ENV` inherited from the agent's shell. Which can be found from files alone, which need a tool call, what each costs.
2. Worktrees: a fresh worktree with no `.venv`; worktrees sharing one virtual environment; an editable install whose path points at another worktree's `src` (does a test then import the wrong worktree's code, and how can Squeal detect it from `.pth` or `direct_url.json`?). What should the daemon do in each: wait, report `unknown`, refuse with a note.
3. Environment hash: interpreter version and implementation, the lockfile (`uv.lock`, `poetry.lock`, `requirements*.txt`) against the installed set (`*.dist-info`), environment variables pytest reads (`PYTHONPATH`, `PYTEST_ADDOPTS`, `PYTEST_PLUGINS`). What changes the result of a test, what only changes the installed set, and how a `uv sync` in a running worktree should recreate the runner.
4. Setup: what `squeal setup` (spec 005 D3) can detect and seed for a pytest project, and what it must ask.
5. Recommendation: the discovery order, the environment hash, and the worktree rules, with the fixture tests that would prove them.
