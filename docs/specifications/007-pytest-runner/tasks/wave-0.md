# 007 wave 0 briefs

The three rows run in parallel on disjoint seams. Workers read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/007-pytest-runner/spec.md` and `status.md` first. Python environments are created only by `uv` into directories under the repository's ignored paths or the OS temp directory; never `pip install --user`, never the system Python, never the real `HOME`'s config.

## 007-04 research: no-venv-resolution

Outcome: evidence on whether a worktree without a Python environment can key pytest files (spec open question 1, the human's ask at approval).

Shape: research. Topic `no-venv-resolution` in `research/README.md`; rules for findings documents and probes as that file states. Probes under `research/probes/no-venv-resolution/`; real projects are cloned there and synced there only. Owns `docs/specifications/007-pytest-runner/research/` only; never edit `docs/board.md`.

Done when: `research/no-venv-resolution.md` is committed with every question tagged or "not determined, because".

Use /researcher.

## 007-10 `pytest` policy and the Python environment

Outcome: `squeal.config.json` accepts `pytest` projects, and a library computes a project's environment from files: discovery, the three refusal states, the fingerprint and hash, the `sys.path` model and the pytest config file (spec D1, D2, the D4 resolution inputs).

Shape: slice. Seam: `src/core/types/policy.ts`. First edit: `PytestProject` beside `NodeTestProject` (`name`, `cwd?`, `python?`, `args`, `env`, `include`, `exclude?`, `slow?`) and `pytest: readonly PytestProject[]`, default `[]`; then its loader as `src/core/daemon/policy-pytest.ts` after `policy-node-test.ts`, wired into `policy.ts`. Then `src/runners/pytest/environment/`: discovery (never above the worktree, never `VIRTUAL_ENV` or `PATH`), the states (none, editable outside the worktree from `direct_url.json`, fingerprint differs), the hash inputs of D2, the interpreter query with `-I -S` cached by the binary's stat, the import roots from `pyvenv.cfg`, `.pth` lines and the setuptools and hatchling finder literals, and the pytest config file by D1's precedence. No adapter, no daemon wiring.

Owns: `src/core/types/policy.ts` (the pytest part), `src/core/daemon/policy-pytest.ts`, the one wiring line in `src/core/daemon/policy.ts`, `src/runners/pytest/environment/**`, `test/runners/pytest/environment/**`, `test/policy/**` (pytest cases), the skill's `references/policy.md` (the `pytest` key). Leave alone: `test/fixtures/pytest/**` and `.github/**` (007-11), every other `src/` module.

Done when: tests on synthetic environment trees (a hand-written `pyvenv.cfg`, `.pth`, `direct_url.json`, finder files) cover every discovery case and state; a foreign `VIRTUAL_ENV` changes nothing; a lockfile edit leaves the hash unchanged and a new `.dist-info` changes it; the interpreter query runs against `python3` when present and is skipped with a reason otherwise; lint, typecheck and the full suite green. Report every type change.

Use /worker.

## 007-11 pytest fixtures and CI Pythons

Outcome: the fixtures waves 1 and 2 test against exist, with uv environments on Python 3.10 and 3.13 created by one helper, locally and in CI.

Shape: slice. Seam: `test/fixtures/pytest/small/`, copied from `research/probes/python-module-graph/fixtures/small` and trimmed to the spec's Testing list. First edit: that copy with its `uv.lock`. Then `test/fixtures/pytest/gen-big.py` from the research generator (deterministic, output gitignored); an edge-case file with every import form of spec D4; failing, collection-error, hanging-with-child, setup and teardown error, xfail and xpass files; the research's `ast_graph.py` as the graph oracle; `test/helpers/pytest-env.ts`, which copies a fixture to a temp directory and runs `uv sync --python <version>` there with uv's own cache, reporting "uv or the Python version is absent" as a skip reason, and failing instead when `CI` is set; `.github/workflows/ci.yml` installs uv and Pythons 3.10 and 3.13.

Owns: `test/fixtures/pytest/**`, `test/helpers/pytest-env.ts`, `test/runners/pytest/fixtures.test.ts`, `.github/workflows/ci.yml`, `.gitignore` lines for the fixtures. Leave alone: everything under `src/`, `test/runners/pytest/environment/**` (007-10).

Done when: `fixtures.test.ts` syncs the small fixture on both Pythons and runs its tests with plain `python -m pytest`, asserting each designed outcome; the generator runs under 5 s; no `.venv`, `__pycache__` or `.pytest_cache` is left in the repository tree; lint, typecheck and the full suite green; the branch's CI run is green (push the branch and read `gh run list --branch <branch>`).

Use /worker.
