# python-module-graph probes (THROWAWAY)

Throwaway experiments for `../../python-module-graph.md` (board row 007-02). Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-13: CPython 3.13.14 and 3.10.20 (uv-managed), pytest 9.1.1, pytest-mock 3.16.0, pytest-testmon 2.2.0 with coverage 7.16.2, grimp 3.17, web-tree-sitter 0.27.1 with tree-sitter-python 0.25.0, Node 24.21.0, uv 0.12.2. Linux x64, 24 cores, shared host at load 12 to 35, so timings are ranges.

## Isolation

`source env.sh` first. It points uv's cache, interpreters and tools, `HOME` and the XDG directories at `.uv/` and `.home/` inside this folder, so nothing reaches the real `HOME` or the system Python. Every environment is a `uv venv` or `uv sync` inside a fixture folder. `.venv*`, `.uv/`, `.home/`, `node_modules/`, `fixtures/big/`, `results/*.json`, `sources/`, `.testmondata*` and caches are git-ignored. No agent tooling was run.

## Fixtures

- `fixtures/small`: a common pytest project. `pyproject.toml` with `[tool.pytest.ini_options]`, `src/app` (hatchling, editable through a path `.pth`), a uv workspace member `packages/other` (setuptools, editable through a path `.pth`, with a namespace package `acme.ns` and a `pytest11` entry-point plugin), `tests/` with a root `conftest.py` naming `pytest_plugins`, a nested `tests/unit/conftest.py`, a parametrized test, `mocker` from pytest-mock, package data read through `importlib.resources`, a test data file read by relative path, and `src/app/core.py` holding every import form of the brief. `src/app/edge/cases.py` stresses the parsers. `uv sync -p 3.13`.
- `fixtures/hook`: the two import-hook editables. `h` is hatchling with `dev-mode-exact = true` (an `editables` redirector), `s` is setuptools with a mapped `package-dir` (an `__editable___*_finder.py` with a `MAPPING` literal). `uv venv -p 3.13 .venv && uv pip install -e ./h -e ./s editables`.
- `fixtures/big`: generated, `python3 gen_big.py fixtures/big` (960 modules in `src/big`, 40 in the workspace member `packages/libb`, 200 test files in 10 directories each with a `conftest.py`, every import form). `uv sync -p 3.13` and `UV_PROJECT_ENVIRONMENT=.venv310 uv sync -p 3.10`.

## Scripts

| Script | Question |
|---|---|
| `gen_big.py` | the 1,000-module fixture |
| `observe_plugin.py` | Q3: a `-p` plugin with four modes: `modules` (sys.modules after collection and after the run), `edges` (wraps `builtins.__import__` and `importlib.import_module`), `audit` (`sys.addaudithook` "import" events attributed to the file being collected or run), `none` |
| `truth.sh` | ground truth: one pytest process per test file with `observe_plugin` in `modules` mode |
| `ast_graph.py` | Q1: `ast` plus the interpreter's own `sys.meta_path` finders, no project code executed; pytest's prepend basedirs modelled; resolution candidates |
| `node_graph.mjs` | Q1, Q5: Node only, files only. `--parser=scan` (hand-rolled scanner) or `--parser=treesitter` (WASM); sys.path from `pyvenv.cfg`, `.pth` lines, setuptools `MAPPING` and editables `map_module` literals; `--reresolve=N` times full re-resolves; reverse index cost |
| `grimp_graph.py` | Q1: grimp 3.17 from `.venv-tools`, `PYTHONPATH` set to the fixture's roots |
| `compare.py`, `compare_lib.py`, `diffgraph.py`, `obs_to_graph.py` | per-test-file closures against the truth; edge agreement between graphs |
| `testmon_probe.py` with `edits-*.json` | Q6: plain against `--testmon` timings and selection per edit, against static and observed closure holders |

`results/summary.txt` and `results/candidates.txt` hold the console output the findings cite.
