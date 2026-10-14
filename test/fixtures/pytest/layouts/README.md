# layouts fixture

Copied from 007-04's probe (`docs/specifications/007-pytest-runner/research/probes/no-venv-resolution/fixtures/layouts`). A uv workspace with one editable root per build backend's layout: the root `app` (uv_build, `src/`), hatchling auto-detected (`hauto`), setuptools flat with a finder mapping (`sflat`), setuptools `find.where = ["lib"]` (`sfind`), pdm-backend (`pdmb`), flit `src/` (`flitm`), poetry-core with `from = "source"` (`poet`), uv_build with `module-root = ""` (`uvflat`); a non-editable (`vendor/pathdep`) and an editable (`vendor/pathed`) path source; and `shared.py` in two roots to test `.pth` order.

`test/runners/pytest/graph/derive-roots.test.ts` checks the roots derived from these `pyproject.toml` files against what `uv sync` wrote on 3.10 and 3.13 in 007-04 (`results/layouts.actual.json`). `uv.lock` is kept from the probe; tests never sync this fixture, since its backends would need downloading.
