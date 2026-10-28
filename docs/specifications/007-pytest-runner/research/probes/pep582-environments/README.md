# Throwaway probes for `research/pep582-environments.md`

Throwaway. Nothing here is product code; delete it whenever the findings file no longer needs it.

- `fixture/`: a PDM project in PEP 582 mode (`pdm.toml` sets `python.use_venv = false`): `src/app`
  installed editable by pdm-backend, a second package `packages/lib` as an editable path dependency
  in a PDM dependency group, `tests/` with a root and a nested `conftest.py`, a parametrized test,
  `mocker` (pytest-mock), `settings` (pytest-django), pytest-xdist, and two tests that start a child
  Python (`sys.executable` and `python` from `PATH`). `tests/conftest.py` dumps the import state
  when `DUMP_TO` is set.
- `lib.sh`: every script sources it. It points `HOME`, `XDG_*`, `PDM_HOME` and `PDM_CACHE_DIR` into
  `scratch/`, and `UV_PYTHON_INSTALL_DIR` and `UV_CACHE_DIR` too, so PDM, its caches and the
  interpreters it runs stay under this folder. `load` prints the one-minute load average per run.
- `run-0-tools.sh`: installs PDM 2.29.4 into `scratch/tools/.venv` and CPython 3.10, 3.11 and 3.13
  into `scratch/pythons`.
- `run-1-install.sh` to `run-9-venv-override.sh`: the probes, one per finding group. Each copies
  `fixture/` into `scratch/w/main` (a git repository) or works in worktrees nested inside it, as
  Cezar nests them. `run-8-base-site.sh` writes a fake distribution into the probe-owned 3.13
  interpreter under `scratch/pythons` and removes it at the end.
- `run-5-dashboard-files.sh` and `run-7-graph.sh` read `~/projects/saas-bp-management-dashboard`
  without running anything there: no pdm, pytest, project Python or docker. They read files with
  `python3 -I` scripts from this folder and with Squeal's own static graph (`graph-probe.ts`,
  `graph-diff.ts` through `tsx`), which parses files and starts no Python.
- `boot/sitecustomize.py`: a PDM-free stand-in for PDM's `pep582/sitecustomize.py`, used to test a
  plain command line.
- `compare.py`, `reach.py`, `snap.py`, `lockcheck.py`: small readers of the probe output.
- `out/`: the captured output each finding cites. `<S>` stands for `scratch/`.

`scratch/` (about 500 MB: interpreters, PDM, caches, worktrees) is git-ignored. Run order:
`run-0`, then `run-1`, then any other.
