# 007 pytest runner

Stage: shipped 2026-10-15 (0.1.195); approved 2026-10-14 by the human; amendments in `status.md`. Written from `research/pytest-runner-api.md` (007-01), `research/python-module-graph.md` (007-02) and `research/python-environments.md` (007-03).

## Problem

Squeal validates Vitest and node:test suites. A Python project gets nothing: an agent editing it runs `pytest` itself after every change, or forgets to. ADR 0001 named pytest the second runner; ADR 0004 moved it behind node:test. pytest is the most used Python test runner, so it is the runner that takes Squeal past JavaScript.

pytest gives Squeal less than Vitest and different problems than node:test. There is no warm instance to reuse: a pytest process kept alive between runs re-runs edited modules from Python's import cache (runner-api F1). The daemon runs on Node from a bundle without native addons, so it cannot import the project's Python to build a graph. And the interpreter is per worktree and easy to get wrong: an activated shell, a shared virtual environment or an editable install can run another worktree's code and give a wrong verdict (environments 1, 2).

## Goals

Each goal is testable on Python 3.10 and 3.13, pytest 8 and 9, on the research's fixture: a `src/` layout package installed editable by uv into `.venv`, a second workspace package, `tests/` with a root and a nested `conftest.py`, a `pytest11` plugin and a parametrized test.

1. An agent editing a module imported by two of two hundred test files gets a `PASS -> FAIL` for those two within one tool call of the result, and the other files run only if their closure holds a changed path.
2. Check keys are computed from files alone, before any run: a second worktree with its own synced environment inherits every result whose closure and environment hashes match, with zero runs (001 goal 4).
3. Check identity `(project, relative test path, node ID after the path)` is stable across runs and worktrees; parametrized IDs that embed object addresses are named in a note.
4. A collection error in a test file is a `fail` of its file-level check plus every check previously known in it, with pytest's traceback, and never stops the other files of the run; a test that never ends is ended by Squeal's deadline, its file's checks `unknown`, the completed files kept (001 D12).
5. Every run checks the static closure against the modules the test file actually imported: an observed path outside it makes the result incomplete, is stored with its hash, blocks inheritance when its content differs, and schedules the file when it changes.
6. Graph work stays small at 1,000 modules: a cold build under 600 ms, a full re-resolve after an add, a delete or an environment change no slower than the cold build, a plain edit under five percent of it.
7. Tests run under the worktree's own interpreter, configuration, plugins and environment; never another worktree's, never the daemon's `VIRTUAL_ENV`. A worktree whose environment would import another worktree's code runs nothing and says why.
8. Hooks, `squeal status`, `squeal why`, the reports, spec 004's slow tier and spec 005's texts and setup work for pytest checks, and a repository with Vitest or node:test suites beside pytest projects validates all of them in one daemon and one store.

## Non-goals

- testmon, as a key, as `affected` or as a dependency. It sees no code that runs at import time (24 files broke and it selected none), keys only after a run, keeps a database per worktree and adds 21 to 109% to every run (module-graph Q6). It may return later as an ordering signal inside a tier, never to skip a file.
- A warm or forked pytest server. Stale modules are proven (runner-api F1); a clean fork server is a later optimisation with its own compatibility contract.
- `pytest-xdist` inside Squeal's runs. Squeal parallelises by its own processes; an inherited `-n` is overridden.
- Interpreter discovery through tools: Squeal never calls `uv run`, `poetry`, `pdm`, `hatch` or `uv python find`, since each can create an environment or return another worktree's (environments 1). Poetry and Hatch environments outside the tree, conda and pyenv are supported only when declared.
- Creating or syncing an environment. That is the agent's or the human's call; Squeal names the command.
- Snapshot updates, coverage, `--lf`, `--ff`, `--sw`, `--pdb` and other modes that change what runs or wait for input.
- Windows and macOS, Python before 3.10, pytest before 8.

## Design

### D1. Configuration and projects

`squeal.config.json` gains `pytest`, a list of projects, each with `name`, `cwd` (relative to the worktree root, default the root; the directory pytest is run from), `python` (an environment directory or interpreter path relative to `cwd`, default `.venv`; absolute only for a declared out-of-tree environment), `args` (arguments the project's own command passes that change semantics, such as `--ds=settings` or `-p plugin`), `env` (variables merged over the run environment), `include` (test-file globs relative to `cwd`) and optional `exclude`, `slow` (004 D1). The 001 D11 loader rules apply. A project is `(runner "pytest", name)`.

The configuration file is found by Squeal from files, with pytest's own precedence at `cwd`: `pytest.ini` (even empty), `pyproject.toml` with `[tool.pytest.ini_options]`, `tox.ini` with `[pytest]`, `setup.cfg` with `[tool:pytest]`; configs never merge (runner-api F4). Squeal passes it as `-c <file>` so every batch resolves the same config and rootdir whatever files it names. Its `testpaths`, `python_files`, `python_classes`, `python_functions`, `addopts` and `pythonpath` are read for D3 and D6; pytest still applies them itself.

`squeal setup` (005 D3) seeds one entry per detected project: `cwd` where a pytest config or a `tests/` directory sits beside a `pyproject.toml`, `include` from `testpaths` and `python_files`, `python` from D2's discovery, and `args` left empty with a note when `addopts` or `PYTEST_ADDOPTS` holds a flag D6 rejects.

### D2. Interpreter, environment and worktrees

Discovery, never walking above the worktree root (001 D1, environments recommendation 1): the project's `python` if set; else `<cwd>/.venv` (uv, PDM, `venv`, Poetry in-project); else `.pdm-python` when it points inside the worktree; else no environment. `VIRTUAL_ENV`, `CONDA_PREFIX`, `python` on `PATH` and parent directories are never consulted.

States, each with every check of the project `unknown`, nothing stored, and one note, re-checked when `<env>/pyvenv.cfg` appears or changes:

- **No environment.** The note names the command that creates one (`uv sync`, `poetry install`, `pdm install`), chosen from the lockfile present.
- **Editable outside the worktree.** Any `*.dist-info/direct_url.json` with `dir_info.editable` whose `url` lies outside the worktree: the environment would import another worktree's code (environments 2, `out/3`). The note names the package and the path. Nothing runs, since the verdict can be wrong either way.
- **Sync in progress.** The environment fingerprint below differs before and after a run: that run stores nothing and the batch is recomputed (001 lessons defect 12, applied to Python).

A run spawns `<env>/bin/python -m pytest` with `VIRTUAL_ENV=<env>`, `<env>/bin` first on `PATH`, and `VIRTUAL_ENV`, `CONDA_PREFIX` and `PYTHONHOME` of the daemon removed, so a test's own `subprocess.run(["python", ...])` reaches the same environment (environments 1).

The environment hash of a pytest project (001 D3): Squeal and adapter versions; the interpreter's real path, `sys.version`, implementation and cache tag, asked once with `-I -S` (16 ms) and again when the binary's stat changes; the bytes of `pyvenv.cfg`; the sorted site-packages entry names, where the entries of a distribution whose `direct_url.json` names an editable install inside the worktree (its `.dist-info` and its `__editable__` files) appear without their version, since setuptools_scm and its kind put the commit there and the closure already keys that code (amended 2026-10-15, `lessons.md` defect 3); the bytes of every `.pth` and every `direct_url.json`; the pytest config file's bytes; `args` and `env`; the allow-listed variables `PYTHONPATH`, `PYTHONSAFEPATH`, `PYTHONNOUSERSITE`, `PYTEST_ADDOPTS`, `PYTEST_PLUGINS`, `PYTEST_DISABLE_PLUGIN_AUTOLOAD`, `PY_IGNORE_IMPORTMISMATCH` and policy `env.allowlist`; the closure of every `pytest11` entry-point plugin and `-p` plugin inside the worktree (D4), found from `entry_points.txt`. The lockfile is not in it: a lock edit changes nothing until a sync. Computed from files in about 2 ms (environments 3). A change recreates the project's runner state before the next tier.

### D3. Test files, identity and outcomes

`testFiles()` expands `include` minus `exclude` under `cwd` with Squeal's matcher. A check's name is the node ID after the file path (`TestOuter::TestInner::test_nested`, `test_add[1-2]`); pytest already suffixes duplicate explicit IDs (`same0`, `same1`). Doctests are checks named as pytest names them. An ID holding a memory address (`0x...`) is kept and named in one note per project, since it changes every run (runner-api F3).

A test's outcome joins its three phases: a failing setup or teardown is `fail` with that phase's error, even after a passing call; `skip` is `skip`; xfail is `skip` (pytest does not claim the code works); non-strict xpass is `pass`; strict xpass is `fail`. A check's location is the test's line from `report.location` (zero-based, made one-based); an error's location is `reprcrash` when present, which may name a helper or fixture line. A project whose run skipped every collected test gets one note, since pytest exits 0 then (a Django project without settings does, runner-api F7).

### D4. Closure and keys

A graph builder under `src/runners/pytest/graph/` parses every project `.py` file the resolver reaches with tree-sitter-python as WebAssembly, bundled beside the node:test runtime files: it equalled the interpreter's own `ast` on every file of the research fixture, parses grammar newer than the project's Python, and needs no interpreter (module-graph Q1). Import forms: `import a.b`, relative imports, `from a import b` as the submodule `a.b` when one exists and as a name otherwise, both arms of `try/except ImportError`, function-local imports, and `importlib.import_module` and `__import__` with a literal. Imports under `if TYPE_CHECKING:` are left out. A non-literal dynamic import marks the closure `complete: false` with its line, as 003 does for `import(p)`.

Resolution models `sys.path` from files (module-graph Q1): `pyvenv.cfg` for site-packages, `.pth` path lines in file-name order, the setuptools `MAPPING` and hatchling `map_module` literals of import-hook editables, `pythonpath` from the pytest config, and pytest's import mode: under `prepend` (the default) each test file's basedir, the first directory upward without `__init__.py`, comes first; under `importlib` it does not (runner-api F4). Namespace packages are built by the resolver itself. A resolved path under the environment ends the walk; the environment hash covers it.

The closure of a test file: the file; the `__init__.py` of each of its parent packages, which pytest runs on import; every `conftest.py` from the rootdir down to its directory; the modules a root conftest names in a literal `pytest_plugins`; the transitive static closure of all of these inside the worktree; the resolution candidates of every import, the absent `<dir>/<name>.py` and `<dir>/<name>/__init__.py` in each worktree search location before the winning one, where a winner outside the worktree does not end the scan (amended 2026-10-14 from 007-04, so the candidates are the same with and without an environment); the matching policy `inputs`; observed paths (D6), those of the Python processes a test starts included (amended 2026-10-22, 007-55). The key is 001 D3's. Observed-only paths persist in a `meta` key per project and enter `closure()`, as 003 D3 does.

A worktree with no environment resolves from import roots derived from `pyproject.toml` (the build backend's layout, uv workspace members reachable from the root, editable `[tool.uv.sources]` paths, in `.pth` file-name order) and from the bundled `sys.stdlib_module_names` of each supported Python minor in place of the stdlib (amended 2026-10-14 from 007-04: closures equal the synced ones for 97 of 97 files). Its closures and `affected` work; its checks stay `unknown` until the environment exists (D2), since the environment hash needs one. A project whose layout the derivation does not cover (`setup.py`, build hooks) is resolved only with an environment, with one note.

### D5. Invalidation and affected

`invalidate(paths)`: a content change re-parses one file; an add, a delete, or a change to `pyvenv.cfg`, a `.pth` file, `pyproject.toml`, `setup.cfg` or the pytest config clears the resolver cache and re-resolves every closure from cached parses (134 to 180 ms at 1,281 files, module-graph Q5). This replaces incremental rules: a new module that shadows another, a new `__init__.py` and a new `_fast` module behind `try/except ImportError` are all caught through candidates.

`affected(changed)`: a reverse index from path to test files. `direct` is the one-hop importers, a changed test file, and for a changed `conftest.py` every test file in its directory and below; `transitive` is the rest of the closure holders; every file of the project when the environment hash changed.

### D6. Running

`run(testFiles, options)` splits the files into batches and runs up to the tier size of batches at once, each a fresh process in its own process group: `<env>/bin/python -m pytest -c <config> -p squeal_pytest --continue-on-collection-errors <overrides> <args...> <files...>` from `cwd`. Batching amortises the 0.7 to 1.5 s pytest start (runner-api F1, F5: four five-file batches took 1.3 to 2.2 s where twenty single-file processes took 6.8 to 7.4 s). Batch size is a policy value, default 5; a slow file (004) runs alone.

`squeal_pytest` is a dependency-free Python module kept as `src/runners/pytest/runtime/`, copied into each plugin's `dist/pytest/` and put on the child's `PYTHONPATH`, behind the project's own entries. It writes JSON lines to `<logDir>/events-<i>.jsonl`, never to stdout: collection reports, item start, every `pytest_runtest_logreport` phase with outcome, duration, location and the long representation, deselections, warnings, and a final session record. It also wraps `builtins.__import__` and `importlib.import_module` and writes `(importer, imported)` edges, from which reachability gives each test file's observed closure in one process (module-graph Q3: equal to a process per file for 200 of 200 files, +0.1 to +0.8 s per run).

The Python processes a test starts are observed too (amended 2026-10-22, 007-55; `011-core/research/edit-latency.md` E9: a test running `[sys.executable, "-m", "pkg"]` kept a pass after `pkg/cli.py` broke). `squeal_pytest` names the test file in progress, its real path, in `SQUEAL_PYTEST_FILE` of `os.environ`, as pytest names the test in `PYTEST_CURRENT_TEST`: a test sees it in its environment while it runs. The pytest process starts without it. A `sitecustomize.py` beside `squeal_pytest`, on the same `PYTHONPATH` entry, runs at the start of every process that inherits the environment: `python -m`, a console script, a script, their own children. With the variable set, the process records each project file it finds to import, and the script it runs, as a `spawned` record in the batch's events file, under that test file. The script, the file `sys.argv[0]` names, is recorded at start-up, so one that imports nothing is recorded too (review 0.1.268 B2). A module is recorded when the import system finds it, before it runs, so one that raises on import is recorded too. These paths join the test file's observed closure, and D5 counts the test file as their direct importer: the test starts the process that imports them. Only the daemon whose run recorded them knows they came from a child; the store keeps them with the other observed paths, so another worktree or a restarted daemon finds the test file as `transitive` until it runs there. The module then runs the `sitecustomize` it shadows on `sys.path`, an environment's or a distribution's; without the variable that is all it does, importing only `importlib.machinery`. Not observed: a process started with an environment that drops `PYTHONPATH` or the variable, or with `-I`, `-E` or `-S`, and every process of a project whose own `PYTHONPATH` entries hold a `sitecustomize`, which shadows this one. `PYTEST_ADAPTER_VERSION` 3 re-keys every result stored before this amendment, since such a result sits at a key whose closure lacks what the test's child processes import, and an E9-style false pass among them would otherwise stay current until its file ran again.

Overrides keep the run whole and the tree clean: `--maxfail=0`; `-n 0` when `pytest-xdist` is installed and `--no-cov` when `pytest-cov` is, known from the installed set (an unknown flag is a usage error); `-o cache_dir=` under Squeal's temp directory; `PYTHONPYCACHEPREFIX` under it too, so no `.pyc` is written into the worktree (to verify in wave 1). `addopts` and `PYTEST_ADDOPTS` stay in force, since `-m`, `-k` and `--ds` there define the project's suite; a flag Squeal cannot override (`--lf`, `--ff`, `--sw`, `--pdb`, `--snapshot-update`, `--looponfail`) in either makes the project a runner failure with one note naming it.

Results come only from the event file. A file is completed when its collection finished and every item it collected has its teardown report, and the process has exited; the session record is not required, so a batch killed in a later file keeps the earlier files that tore down completely (amended 2026-10-14, review 007-16 input 5); its whole-file duration is the sum of its items'. A failed collection report is a `FileLevelError` with its traceback; a module-level skip skips the file's known checks. A session teardown error after every file completed is one note on the run, not a test failure. Exit codes are recorded in the run log: 3 (internal error) and 4 (usage error) are runner failures, 5 (nothing collected) is a note, and none of them is trusted for a verdict (runner-api F6).

Squeal's `runner.timeoutMs` is the deadline, one per tier: on expiry each process group gets SIGTERM, then SIGKILL after two seconds, so children the tests started die with it; completed files keep their results, the rest are `unknown`. `pytest-timeout` is left to the project; its thread method loses reports, which only makes those files incomplete.

### D7. Enumeration

`enumerate(testFile)` walks the tree-sitter parse of D4: module-level functions matching `python_functions` (default `test*`), methods of classes matching `python_classes` (default `Test*`) without an `__init__`, nested classes, `unittest.TestCase` subclasses' `test*` methods. A function with a `parametrize` mark, or any non-literal construct, is one `templated` entry. After the file has run, the observed node IDs stand (001 D4's `test.each` rule). `--collect-only` is never used: it imports the module (runner-api F3).

### D8. Agents, policy and amendments

005's texts, skill and instruction block name pytest projects where they name Vitest and node:test. 005 D8 recognises `pytest`, `python -m pytest`, `uv run pytest` and `<env>/bin/pytest` with test paths and node IDs as arguments and only output flags, when the command would run from a configured project's `cwd`; anything else falls through. 004 applies unchanged: `slow.include` matches pytest files, and an entry's `slow: true` marks all of them. 001 D11 gains the `pytest` key; D3's closure definition gains "for pytest, as 007 D4 defines it". `runner.timeoutMs` and `runner.tierSize` apply to every runner.

## Testing

- Fixtures under `test/fixtures/pytest/`: the research's small project (`research/probes/python-module-graph/fixtures/small`) with uv-managed environments for Python 3.10 and 3.13, built by a setup script that never touches the user's site or `HOME`; the 1,000-module generator (`gen_big.py`) moved there; an edge-case file holding every import form of D4. CI installs uv and both Pythons.
- Graph tests: `closure()` of every small-fixture file equals the interpreter's `ast` resolution (the research's `ast_graph.py`, kept as an oracle) and contains a real run's observed closure; a `TYPE_CHECKING`-only target is absent; a computed `import_module` is `complete: false` with its line; a root `big.py`, a new `_fast` module and a new `__init__.py` re-key exactly the files their candidates name; a `pytest11` plugin's closure is in `environment().files`; cost relative to the cold build.
- Environment tests: a nested worktree with the parent's `.venv` and none of its own is `unknown` and never runs the parent's interpreter; `.venv -> ../main/.venv` refuses with the editable-outside note; a foreign `VIRTUAL_ENV` in the daemon's environment changes neither the interpreter nor a test's child `python`; `uv pip install` of another plugin version re-keys every file and `uv lock` alone re-keys none; `PYTEST_ADDOPTS` re-keys; a run overlapping `uv sync` stores nothing; 3.10 and 3.13 environments key differently.
- Runner tests, on recorded event files and live runs: phase joining (setup error, teardown error after a pass, skip, xfail, both xpasses); a collection error in one file of a batch leaves the others' results; a hung test killed at the deadline with its spawned child; a batch killed mid-file keeps the completed files; `-x` and `-n 2` in `addopts` are overridden; `--lf` in `PYTEST_ADDOPTS` is a runner failure; no `.pyc` and no `.pytest_cache` appear in the worktree.
- Integration: a repository with a Vitest suite and two pytest projects runs a baseline, inherits it into a second worktree with its own `uv sync`, and delivers a `PASS -> FAIL` in a pytest file through the Claude Code and Codex hooks; `squeal setup` seeds both projects.
- End to end, as 001's `test/e2e`: the shipped plugin against the fixture.
- Proof: a dogfooding row on a real open-source pytest project of a few hundred test files, with a Cezar worker on Claude Code and one on Codex, reported in `lessons.md`.

## Open questions

Owner is the coordinator unless noted.

1. For the human: a fresh worktree without an environment inherits nothing until it is synced (D2, D4), so Cezar workers in a Python repository start with zero inherited results unless their worktree setup runs `uv sync`. Measured by 007-04 (2026-10-14): the closure half of a key and `affected` work without an environment (D4, amended), but no file-only stand-in exists for the environment hash, since one lock gives different installed sets per Python minor, sync flags and stale path sources. What remains possible: a synced worktree records that its lock, pin, selection and path-source content produced environment hash E, and an unsynced worktree with equal inputs reads results under E until its own environment appears. Decided by the human on 2026-10-15: not built. Instead, the no-environment note tells the agent that installing brings the results other worktrees recorded for the same code and environment (task 007-44), and 001 words the Node install sentence the same way.
2. Data files read at run time (`importlib.resources`, `Path(__file__).parent / "data"`) enter no closure; they are declared `inputs` until a Python counterpart of `observe.runtimeInputs` (an audit hook on `open`) is measured for cost and per-file separation. Measured in wave 1 (`status.md`): reads inside a test separate per file; crediting import-time reads to the imported module is row 007-51.
3. `PYTHONPYCACHEPREFIX` keeps the tree clean but gives up the project's existing `__pycache__`: measure the start-up cost in wave 1; the fallback is the watcher ignoring `__pycache__`.
4. A nested conftest's `pytest_plugins` errors under the project's own `pytest` but passes when files are named (module-graph Q2). Squeal reports it as a runner note rather than reproducing the error. Decided here unless wave 1 shows otherwise.
5. Batch size and the crossover with slow session fixtures are unmeasured on a real suite (runner-api F5); the default of 5 is revisited in the dogfooding row.
6. Reverse-index memory at 10,000 modules, as 003's open question 5.
7. Taking uv's `.venv/.lock` needs a native `flock`; D2 relies on the fingerprint before and after a run instead. Revisit if the dogfooding shows a run reading a half-synced environment.

## References

- ADRs 0001 and 0004: `../../decisions/`.
- Spec 001 D3, D4, D5, D11, D12 and `lessons.md` defect 12; spec 003 D3 to D6; spec 004 D1; spec 005 D3, D6, D8.
- Research: `research/pytest-runner-api.md`, `research/python-module-graph.md`, `research/python-environments.md`; from 001, `research/result-fingerprinting-prior-art.md` (testmon keys).
- Interface: `src/core/types/runner.ts`.
