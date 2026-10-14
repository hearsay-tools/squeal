# no-venv-resolution probes (THROWAWAY)

Throwaway experiments for `../../no-venv-resolution.md` (board row 007-04). This is not product code. Squeal does not import, build or test anything here; delete freely.

Run on 2026-10-14: CPython 3.10.20 and 3.13.14 (uv-managed), uv 0.12.2, pytest 9.1.1, Node 24.21.0, web-tree-sitter 0.27.1 with tree-sitter-python 0.25.0, smol-toml 1.9.1. The build backends uv fetched that day were hatchling 1.32.4, setuptools 84.0.0, pdm-backend 2.5.0, flit_core 3.12.0 and poetry-core 2.5.0; uv_build was the one built into uv 0.12.2. Host: Linux x64.

## Isolation

Run `source env.sh` first. It points uv's cache, interpreters and tools, `HOME` and the XDG directories at `.uv/` and `.home/` inside this folder, and sets `UV_NO_CONFIG=1`. `run-q3-python.sh` unsets `UV_NO_CONFIG` for one sync, with `HOME` and XDG still inside the probe and no `/etc/uv` on the host. Every environment is created by `uv sync`, `uv venv` or `uv pip install -p <venv>` inside a fixture folder. `.venv*`, `.uv/`, `.home/`, `node_modules/`, `work/` and `results/q2/` are git-ignored. No agent tooling was run.

## Fixtures and projects

- `fixtures/layouts`: a uv workspace with one editable root per backend layout. The root `app` uses uv_build with `src/`. The members are hatchling auto-detected, setuptools flat (finder), setuptools `find.where = ["lib"]`, pdm-backend, flit `src/`, poetry-core with `packages = [{include, from = "source"}]` and uv_build with `module-root = ""`. There is also a non-editable and an editable path source under `vendor/`, and `shared.py` in two roots to test `.pth` order.
- `work/fix/{small,hook,envfix}`: copies of `../python-module-graph/fixtures/{small,hook}` and `../python-environments/fixture`.
- `work/real/`: shallow clones of attrs 25.4.0 (hatchling, `9a98e00`), click 8.3.0 (flit_core, `00fadb8`), pluggy 1.6.0 (setuptools, `fd08ab5`) and cleo 2.1.0 (poetry-core, `f695cd3`). attrs and click are synced with `uv sync`; pluggy and cleo use `uv venv` plus `uv pip install -e . pytest [pytest-mock]`. Each has a `.venv` on 3.13 and a `.venv310` on 3.10.

## Scripts

| Script | Question |
|---|---|
| `roots.mjs derive <root> [dirs]` | Q1: import roots from `pyproject.toml` files alone (uv workspace members reachable from the root, `[tool.uv.sources]` paths, one rule set per backend), in `.pth` file-name order |
| `roots.mjs actual <root> [venv]` | Q1: the roots a sync wrote (`.pth` path lines, setuptools `MAPPING`, editables `map_module`) |
| `cmp_roots.mjs` | Q1: derived against actual |
| `run-q1-cases.sh` | Q1: sync flags and settings that change the installed set (`--all-packages`, `--no-install-project`, `--no-editable`, `package = false`, hatch `sources`, two `find.where`) |
| `graph.mjs` | Q2: `../python-module-graph/node_graph.mjs` plus `--roots=<derived.json>` (no environment), resolution candidates as `ast_graph.py` defines them, `--sym` and `--stdlib=<names>`. Two fixes to the copied parser are marked `007-04 fix` |
| `ast_graph.py` | Q2: unchanged copy of the oracle |
| `run-q2.sh`, `cmp_closures.mjs` | Q2: per test file, closure files and candidates between two graphs |
| `cand_cost.mjs`, `closure_sizes.mjs` | Q2: candidates per closure under D4's rule against `--sym` |
| `envinputs.mjs`, `run-q3-worktrees.sh` | Q3: spec D2's hash inputs of two worktrees synced from one lock |
| `run-q3-lock.sh` | Q3: one `uv.lock`, several installed sets, and `uv sync --check` on each |
| `run-q3-pathdep.sh` | Q3: a non-editable path source edited after a sync |
| `run-q3-python.sh` | Q3: which interpreter a plain `uv sync` picks |

The `results/*.txt` files hold the console output the findings cite, and `results/*.json` hold the derived and actual roots.
