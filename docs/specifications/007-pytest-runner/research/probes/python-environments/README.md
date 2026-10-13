# Throwaway probes for `research/python-environments.md`

Throwaway. Nothing here is product code; delete it whenever the findings file no longer needs it.

- `fixture/`: a common pytest project (uv workspace, `src/app`, second package `packages/lib`,
  root and nested `conftest.py`, a parametrized test, `mocker` from pytest-mock).
- `run-*.sh`: the probes. Each copies `fixture/` into `scratch/` (git-ignored), makes it a git
  repository with worktrees there, and creates every virtual environment under `scratch/`.
- Third-party environment managers (Poetry, PDM, Hatch) are installed into `scratch/tools/.venv`
  and run with `HOME` and `XDG_*` pointed at `scratch/home`, never the real HOME.
- `out/`: the captured output each finding cites.
