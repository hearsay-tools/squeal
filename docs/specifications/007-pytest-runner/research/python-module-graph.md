# Research: python-module-graph

Researcher task for spec 007, board row 007-02. Versions: **CPython 3.13.14 and 3.10.20** (uv-managed), pytest 9.1.1, pytest-mock 3.16.0, pytest-testmon 2.2.0 with coverage 7.16.2, grimp 3.17, web-tree-sitter 0.27.1 with tree-sitter-python 0.25.0, Node 24.21.0, uv 0.12.2. Linux x64, 24 cores, shared host at load 12 to 35, so timings are ranges.

Probes: `probes/python-module-graph/` (throwaway, see its README; every number below is in `results/summary.txt`). `fixtures/small` is the brief's common project: `src/app` (hatchling) and a uv workspace member `packages/other` (setuptools, namespace package `acme.ns`, a `pytest11` plugin), both editable; root and nested `conftest.py`, `pytest_plugins`, `mocker`, a parametrized test, package data and a test data file. `fixtures/big` is generated: 960 modules in `src/big`, 40 in `packages/libb`, 200 test files in 10 directories each with a `conftest.py`, every import form of Q1; 1,281 `.py` files; median observed closure 628 files. Ground truth: one pytest process per test file, `sys.modules` after collection and after the run.

## Questions answered

| # | Short answer |
|---|---|
| 1 | A static graph from files alone matched the observed closure for 200 of 200 files on 3.10 and 3.13. Three builders agree: `ast` in the project's interpreter, tree-sitter WASM in Node, and a Node scanner (one miss on an edge file). grimp drops parents and literal dynamic imports. All miss computed imports, data files and entry-point plugins. |
| 2 | Closure: the conftest chain and the root conftest's `pytest_plugins`. Environment: `pytest11` and `-p` plugins, editable ones included. Data files: declared `inputs`. |
| 3 | `sys.modules` and audit events cannot separate files in one process: median 0% attributed. A wrapped `__import__` gives exact per-file closures at +0.1 to +0.8 s per run. |
| 4 | The static closure keys; observed edges check it, as in spec 003. |
| 5 | A full re-resolve costs 134 to 180 ms at 1,281 files, the same as the cold resolve; candidates catch shadowing. |
| 6 | No, as key or `affected`. testmon is blind to import-time code: 24 files broke and testmon ran 0. It also needs a run first and adds +21 to +109% per run. |
| 7 | Pants and Gazelle: static parsers plus conftest and `__init__` rules. pytest-picked: test files only. pytest-incremental: static, deprecated. Jest: static, no check. |
| 8 | See the recommendation. |

## Findings

### Q1. Static graph

Correctness on `fixtures/big` against the per-process truth (`compare.py`, `verified by experiment` on 3.13.14 and 3.10.20):

| Builder | Missing | Extra (total, 200 files) | Wall, 1,281 files | Notes |
|---|---|---|---|---|
| `ast_graph.py` in the project's venv | 0 | 10,602 | 0.38 to 0.41 s (3.13), 0.51 to 0.56 s (3.10) | resolves through the interpreter's own `sys.meta_path` without importing project code |
| `node_graph.mjs --parser=treesitter` | 0 | 10,602 | 0.45 to 0.54 s | parse 134 to 142 ms; 656 KiB of WASM |
| `node_graph.mjs --parser=scan` | 0 | 10,602 | 0.34 to 0.37 s | parse 53 to 80 ms |
| grimp 3.17 | 2,680 | 10,482 | 0.06 to 0.09 s (build only) | 200 after adding parent packages by hand: `computed_target.py`, loaded by `__import__("big.computed_target")` |
| `ast`, `TYPE_CHECKING` skipped | 0 | 10,402 | same | |

The extras are imports that never ran: function-local imports in functions no test calls, and `TYPE_CHECKING` blocks. They over-run and never miss. Both Node builders produce edges identical to the `ast` helper on all 1,281 files. On `src/app/edge/cases.py`, tree-sitter equals `ast`; the scanner misses `if True: import app.edge.e`. The file holds multi-line imports, imports in strings and comments, `;`, class bodies, `match` and nested f-strings. CPython 3.10's `ast` rejects the 3.12 nested f-string, while tree-sitter-python 0.25 parses it, so the Node parser does not depend on the project's Python. `verified by experiment`.

Import forms. All three builders handle `import a.b` (loads `a`, `a.b`), `from . import x` and `from ..p import x`, `from a import b` with `b` a module (resolved as `a.b` when such a submodule exists, else a name), `TYPE_CHECKING` blocks (`if TYPE_CHECKING:` and `if typing.TYPE_CHECKING:`), both arms of `try/except ImportError`, function-local imports, and `importlib.import_module` and `__import__` with a literal. A non-literal argument is reported with its line. A module's own parent packages are an edge: pytest imports `tests/t0/test_3.py` as `tests.t0.test_3`, which runs `tests/__init__.py` and `tests/t0/__init__.py`; without this rule every builder missed 400 paths. `verified by experiment`.

Resolution. The search path is reproducible from files alone (`node_graph.mjs`, `verified by experiment`):

- `pyvenv.cfg` gives the stdlib directory and `site-packages`.
- Default editables add path lines to `.pth` files: hatchling's `_editable_impl_app.pth` holds `<root>/src` and setuptools' `__editable__.other-0.1.0.pth` holds `<root>/packages/other/src`. They join `sys.path` in file-name order, so `packages/other/src` comes before `src`.
- Import-hook editables are literals. setuptools with a mapped `package-dir` writes `MAPPING: dict[str, str] = {'spkg': '<root>/s/lib_src'}` in `__editable___spkg_0_1_0_finder.py`. hatchling's `dev-mode-exact` writes `F.map_module('hpkg', '<root>/h/src/hpkg/__init__.py')`. Both finders follow `PathFinder` in `sys.meta_path`, so a same-named module on `sys.path` wins. uv 0.12.2 did not install `editables`, which that editable's METADATA requires, so its import failed until we installed it.
- pytest's `prepend` mode puts each test file's basedir first on `sys.path` (the rootdir here, since `tests/` has `__init__.py`). A new rootdir `big.py` shadowed `src/big` for every test: `'big' is not a package`.
- Python 3.13's `PathFinder` raises `KeyError` for a namespace child whose parent is not imported, so even the in-interpreter helper builds namespace portions itself.

Blind spots of every static builder (`verified by experiment` on `fixtures/small`): a computed `importlib.import_module("app.plugins." + name)`; `importlib.resources.files("app.data")`, which imports the package `app.data` and reads `values.json`; `Path(__file__).parent / "data" / "sample.txt"`; and a `pytest11` entry-point plugin whose fixture the test uses by name.

### Q2. pytest's own inputs

- Conftest chain: a run of `tests/t3/test_3.py` loads `tests/conftest.py`, `tests/t3/conftest.py` and the root conftest's `pytest_plugins` module, and no other directory's conftest. `verified by experiment`. Fixtures resolve by name, so the chain belongs to the file whether or not the test imports anything from it. Editing a group conftest affects that directory's 20 files; editing the `pytest_plugins` module affects all 200 (E4, E5).
- `pytest_plugins` outside the root conftest: `pytest` and `pytest tests` stop with "Defining 'pytest_plugins' in a non-top-level conftest is no longer supported". The same conftest passes when the test file is named on the command line, because it is then an initial conftest. `verified by experiment`. Squeal's explicit file lists can therefore pass where the project's own command fails (crossing, open question 1).
- Entry-point plugins: `packages/other` declares `[project.entry-points.pytest11] other_plugin = "other.plugin"`. After `uv sync` every run lists `plugins: mock-3.16.0, other-0.1.0, testmon-2.2.0`, and the test using `other_fixture` has no static edge to `other/plugin.py`. `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` turns the test into an error. The plugin is found from files in `site-packages/*.dist-info/entry_points.txt`. `verified by experiment`.
- Data files are seen by no builder, by no `sys.modules` view and by no testmon (S1, S2: 2 plain failures, testmon selected 0). `verified by experiment`.

Proposed split, as 001 D3 separates setup files (`inferred`). **Closure**: the conftest chain and its imports, and the root conftest's `pytest_plugins` modules and their imports. They vary by directory and pytest imports them as ordinary project files. **Environment hash**: the closure of every `pytest11` and `-p` plugin module inside the worktree, since it applies to every file. Plugins outside the worktree count as installed packages. **Inputs**: data files, until observed reads exist for Python.

### Q3. Observed graph

| Method, one pytest process for all 200 files | Wall (3 runs) | Per-file result |
|---|---|---|
| plain | 1.87 to 1.97 s | none |
| `-p observe_plugin`, mode `none` | 1.79 to 1.98 s | none |
| `sys.addaudithook`, "import" events attributed to the module being collected or run | 1.82 to 2.04 s | median 0% of a file's truth attributed to it (max 9%); conftests and earlier files load shared modules first |
| `builtins.__import__` and `importlib.import_module` wrapped, (importer, imported) edges, reachability per file | 2.03 to 2.74 s | equal to the per-process truth for 200 of 200 files (0 missing, 0 extra) once the parent-package rule is added |
| one process per file, `sys.modules` (truth) | 37 to 42 s at 8 in parallel | exact by construction |

`verified by experiment`. The wrapper sees cached imports too: `from x import y` calls `__import__` even when `x` is loaded, which a `sys.meta_path` finder never sees. Audit "import" events also fire for failed attempts (`big.a3.b30.m617_fast`), which gives observed resolution candidates. Collection against run time on `fixtures/small`: `app.lazy`, `app.dyn_literal`, `app.dunder_literal`, `app.plugins` and `app.plugins.alpha` appear only after collection (function-local and dynamic imports). The wrapper does not see `importlib.util.spec_from_file_location` with `exec_module`, imports in child processes, or file reads (`inferred`). coverage.py, measured through testmon, costs +21 to +109% and starts only at the first test (Q6).

### Q4. Which graph the key uses

Goal 4 forces the static closure into the key: the static closure is the only one available in a fresh worktree before a run, and it was complete on every measured file. The observed edges are the completeness check, as in 003 D3/D5. A path the wrapper sees outside the static closure is stored with its hash, the closure is `complete: false`, and inheritance requires a matching hash. A computed `import_module` or `__import__` makes the closure `complete: false` before any run, with its line as the reason, as 003 does for `import(p)`. `inferred` from Q1 and Q3, and from 003 D3.

### Q5. Resolution changes

`node_graph.mjs --reresolve=3` clears the resolver and stat caches and re-resolves all 1,281 files from cached parses in 134 to 180 ms. The cold resolve takes 143 to 176 ms, the result is byte-identical, and building every closure plus the reverse index (126,145 entries) takes 62 to 71 ms. The `sys.path` model, `pyvenv.cfg` plus `.pth` plus finder literals, is rebuilt in 6 to 14 ms. Resolution candidates are the absent `<dir>/<name>.py` and `<dir>/<name>/__init__.py` in every worktree search location before the winning one. They come to a median of 10 and a maximum of 16 per file, 538 distinct on `fixtures/big`. With them, creating `src/big/a2/b23/m477_fast.py` (the `try` arm of a `try/except ImportError`) re-keys 158 of 200 files, creating `big.py` at the rootdir re-keys 200 of 200, and adding `__init__.py` to `acme` is a candidate of its importers. `verified by experiment`. A full re-resolve is cheap enough to replace incremental rules for any add, delete, `.pth`, `pyvenv.cfg` or `pyproject.toml` change; a content edit re-parses one file.

### Q6. testmon as a component

Read in source code (pytest-testmon 2.2.0): MIT; requires `pytest<10,>=5` and `coverage<8,>=6`. The database is SQLite `.testmondata` in the rootdir (or `TESTMON_DATAFILE`). `check_data_version` (`db.py:49`) deletes it when `PRAGMA user_version` differs from `DATA_VERSION = 14`, with no migration. `file_fp` keys a file by `fsha` and per-block `method_checksums`, and `environment` holds the packages with patch versions dropped. `pytest_ignore_collect` skips stable files, so `--testmon` changes what pytest collects. Coverage starts in `start_testmon`, from `pytest_runtest_protocol`, so code that runs during collection is never measured.

Measured on `fixtures/big` (`testmon_probe.py`, `verified by experiment`, 3.13):

| Edit | testmon test files | static closure | observed closure | plain run |
|---|---|---|---|---|
| E1 function body of a module in 148 closures | 1 | 156 | 148 | only the 1 file calls it |
| E9 a module outside every conftest closure raises at import | **0** ("no tests ran") | 28 | 24 | 24 collection errors |
| E7 the same in a module group conftests import | 0 collected, 5 directory errors | 156 | 148 | 53 collection errors |
| E3 `TYPE_CHECKING`-only target | 0 | 200 (0 if skipped) | 0 | no change |
| E4 group conftest, E5 `pytest_plugins` module | 20, 200 | 20, 200 | 20, 200 | |
| S1, S2 package data, test data | 0 | 0 | 0 | 2 failures |
| S3 new module taking over a `try/except ImportError` | 0 | 1 of 2 with candidates | | collection error |

Costs, paired within each of three sessions: plain 1.60 to 1.68 s against 2.61 to 2.81 s with every test under coverage (`--testmon` cold, `--testmon-noselect`); 2.00 to 2.23 s against 2.70 to 2.80 s; 2.77 to 3.38 s against 4.83 to 5.80 s on a busier host. That is +21 to +109%. A no-change run takes 0.85 to 2.16 s. `.testmondata` is 352 KiB for 600 tests, and only 509 of 1,281 files appear in `file_fp`. Squeal's own runs would all need coverage to keep the data current. `-p no:cacheprovider` on the command line crashes it: `INTERNALERROR ... KeyError: 'lf'` (`configure.py:78`).

Conflicts with Squeal's rules (`inferred`):

- Keys need a run first, against goal 4.
- The database lives per worktree, against the shared store.
- Import-time code, new modules and data files are invisible to it.
- A format bump wipes the data.

A hybrid keeps the static closure for keys and `affected`. It would use testmon's block checksums only to order a revision's files within D5's classes, never to skip one: D5 calls a result current only when its key matches.

### Q7. Prior art

- **Pants 2.33** (`read in official docs`, `[python-infer]`) infers statically from import statements with a "Rust-based, multithreaded, in-process dependency parser". Two inferences are opt-in: `string_imports` (strings with at least two dots) and `assets` (strings with a slash). `conftests = True` adds conftests "in the current directory and ancestor directories", and `init_files` defaults to `content_only`. Squeal can reuse the conftest and `__init__.py` rules, and string imports as an opt-in candidate source.
- **rules_python Gazelle** (`read in source code`, `fa2aa246`) parses with go-tree-sitter's Python grammar (`gazelle/python/file_parser.go`). It sends `if TYPE_CHECKING:` imports to `pyi_deps` by default and adds ancestor conftests by default (`python_include_ancestor_conftest`). Squeal can reuse tree-sitter, and type-checking imports as their own class.
- **pytest-picked** (`read in official docs`) runs the test files `git status` reports as changed and follows no imports. Nothing to reuse beyond "a changed test file is direct".
- **pytest-incremental** (`read in source code`, `373cf822`) is a static `import_deps` graph with `doit` file dependencies. It is "DEPRECATED: This project is no longer maintained." It confirms that a static graph is enough to select modules.
- **Jest `--findRelatedTests`** (003's `node-test-module-graph.md` Q6) is static with no observed check. Squeal adds candidates and the check.

## Recommendation for Squeal

1. **Closure of a pytest test file**: the file; its own parent packages' `__init__.py`; every `conftest.py` from the rootdir down to its directory; the modules the root conftest names in a literal `pytest_plugins`; the transitive closure of all of these over static import edges inside the worktree (every form of Q1, function-local and both `try` arms included, `TYPE_CHECKING` blocks left out); the resolution candidates of every import; matching policy `inputs`; observed paths (Q4). Leave out `.venv` and `site-packages`, which the environment covers.
2. **Parser and resolver in the daemon**: tree-sitter-python as WASM. It matched `ast` on every file, parses grammar newer than the project's Python, and needs no interpreter. Model `sys.path` from `pyvenv.cfg`, `.pth` path lines, setuptools `MAPPING`, editables `map_module` and pytest's prepend basedirs. Keep `ast_graph.py`'s approach, the interpreter's own finders, as the test oracle, not as a runtime dependency.
3. **`affected`**: a reverse index from path to test files. `direct` is the one-hop importers, a changed test file and, for a conftest, the files of its directory (open question 3). On any add, delete, `.pth`, `pyvenv.cfg` or `pyproject.toml` change, clear the caches and re-resolve everything from cached parses (about 150 ms at 1,000 modules). A content edit re-parses one file.
4. **Observed check**: a `-p` plugin wrapping `builtins.__import__` and `importlib.import_module` writes (importer, imported) edges per run. Reachability gives each file's observed closure in one process. This replaces 003's process-per-file recorder.
5. **testmon**: not a dependency. At most a later ordering signal; never a key or a skip.
6. **Cost at 1,000 modules**: cold build 0.45 to 0.54 s wall with tree-sitter; re-resolve about 150 ms; closures and reverse index about 65 ms.
7. **First fixture tests of the board row**, using `fixtures/small` and `gen_big.py` moved under `test/fixtures/`:
   - `closure()` of each `fixtures/small` file equals `ast_graph.py`'s, and contains the observed closure of a real run.
   - The computed `import_module` makes the closure `complete: false` with its line.
   - A `TYPE_CHECKING`-only target is absent.
   - A root `big.py`, a new `_fast` module and a new `__init__.py` re-key exactly the files the candidates name.
   - A `pytest11` plugin's closure is in `environment().files`.
   - The cost assertions are relative to the cold build.

## Open questions

1. Crossing with pytest-runner-api: Squeal names test files explicitly, which turns a nested conftest's `pytest_plugins` from an error into a pass (Q2). Should the adapter refuse it with a note? The same topic owns `--import-mode` (importlib changes Q1's basedir rule), `pythonpath` (not measured here), and whether `python -m pytest` puts the cwd on `sys.path`. testmon crashes with `-p no:cacheprovider`.
2. Crossing with python-environments: a fresh worktree with no `.venv` has no `.pth` files, so `src`-layout imports do not resolve. Should the resolver fall back to the build backend's declared layout (`[tool.hatch.build.targets.wheel] packages`, setuptools `where` and `package-dir`, uv workspace members), or report `unknown` until the environment exists? This is not determined, because no fallback was built or measured. The topic also owns an editable `.pth` pointing at another worktree's `src`, and uv not installing `editables` for hatchling's exact mode.
3. Is a conftest edit `direct` for its directory's files, or `transitive`? Does the root conftest belong in every closure (a root conftest edit is then work an edit caused) or in the environment hash (001 D5 then queues its files second)?
4. Data files: is there a Python counterpart of 001's `observe.runtimeInputs` (an audit hook on `open`, `os.listdir` and `os.stat`)? Its cost and per-file separation are not determined, because they were not measured here.
5. `importlib.resources.files("<literal>")` and Pants-style string imports could become modelled edges or candidates. Their false-positive rate on a real project is not determined, because the fixtures are synthetic.
6. Reverse-index memory at 10,000 modules: 126,145 entries at 1,281 files. Not measured; the same as 003's open question 5.

## Sources

- Probes: `probes/python-module-graph/` (`README.md`, `results/summary.txt`, `results/candidates.txt`).
- pytest-testmon 2.2.0, installed wheel: `testmon/db.py` (lines 13, 49 to 60, table DDL 341 to 410), `testmon/testmon_core.py` (`setup_coverage`, `start_testmon`, lines 468 to 600), `testmon/pytest_testmon.py` (`TestmonSelect`, lines 515 to 560), `testmon/configure.py:78`; METADATA `License: MIT`. https://github.com/tarpas/pytest-testmon/tree/v2.2.0
- Pants 2.33 `[python-infer]`: https://www.pantsbuild.org/stable/reference/subsystems/python-infer
- rules_python at `fa2aa2467720a776411c21a197c7c386f8405be1`: `gazelle/python/file_parser.go`, `gazelle/python/generate.go`, `gazelle/docs/directives.md`. https://github.com/bazel-contrib/rules_python/tree/main/gazelle
- pytest-picked README: https://github.com/anapaulagomes/pytest-picked
- pytest-incremental at `373cf8224ae2c86ace11ed28507fd7f4ae052902`: `pytest_incremental.py`, README. https://github.com/pytest-dev/pytest-incremental
- grimp 3.17: https://pypi.org/project/grimp/; web-tree-sitter 0.27.1 and tree-sitter-python 0.25.0 from npm.
- Earlier Squeal research: `../../003-node-test-runner/research/node-test-module-graph.md`, `../../001-core-loop/research/result-fingerprinting-prior-art.md` (testmon keys).
