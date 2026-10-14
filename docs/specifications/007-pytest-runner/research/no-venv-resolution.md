# Research: no-venv-resolution (007-04)

Topic `no-venv-resolution` of `research/README.md` (spec 007 open question 1). Run on 2026-10-14 on Linux x64 with CPython 3.10.20 and 3.13.14 (uv-managed), uv 0.12.2, pytest 9.1.1 and Node 24.21.0. The resolver ran on web-tree-sitter 0.27.1 with tree-sitter-python 0.25.0. Build backends: hatchling 1.32.4, setuptools 84.0.0, pdm-backend 2.5.0, flit_core 3.12.0, poetry-core 2.5.0, and the uv_build built into uv 0.12.2. Probes are in `probes/no-venv-resolution/`, which is throwaway (see its README). The console output cited below is in its `results/`.

Trees measured, 97 test files in all:

- `fixtures/layouts`: a uv workspace with one editable root per backend layout, plus a non-editable and an editable path source.
- The research fixtures `small`, `hook` and the environments fixture.
- Four real projects: attrs 25.4.0 (hatchling), click 8.3.0 (flit_core), pluggy 1.6.0 (setuptools) and cleo 2.1.0 (poetry-core).

Each tree was synced on 3.10 and on 3.13.

## Questions answered

| # | Short answer | Tag |
|---|---|---|
| 1 | From `pyproject.toml` alone, the roots equal what `uv sync` or `uv pip install -e .` wrote, in `.pth` order, on all 8 trees and both Pythons. They differ when the sync command, not the files, chooses the installed set (`--all-packages`, `--no-install-project`, `--no-editable`). They also differ for one setuptools rule the probe did not model. | verified by experiment; rules read in source code |
| 2 | Closure files are equal for 97 of 97 test files on both Pythons. Resolution candidates differ for 86 of 97 under D4's rule. Without an environment, a stdlib or site-packages winner is invisible, so the scan runs on into the roots. They differ for 0 of 97 under a rule where an external winner does not end the scan, with the interpreter's stdlib names as a stand-in. That rule adds a median of 0 to 74 absent paths per closure. | verified by experiment |
| 3 | No. One `uv.lock` gave different installed sets for each Python minor and each sync flag set, and after hand installs. An edited non-editable path source passed both `uv lock --check` and `uv sync --check` while the installed copy stayed stale. Without a pin file, files do not name the interpreter. Separately, spec D2's own hash differs between two worktrees synced from one lock, because `.pth` and `direct_url.json` hold absolute paths. | verified by experiment |
| 4 | The fallback is sound for `affected` and for the closure half of a key now. It is sound for the environment half only as a lookup through a lock-to-environment record written by a synced worktree, never as a hash of its own. | inferred from 1 to 3 |

## Findings

### Q1. Roots from files

`roots.mjs derive` reads `pyproject.toml` files and nothing else. It takes the root project, then the uv workspace members reachable from the root's dependencies and default group, then `[tool.uv.sources]` paths with `editable = true`. Per backend:

- **uv_build**: `<project>/<module-root>`, default `src`.
- **hatchling**: the parent of each `packages` or `only-include` entry. With no selection, it auto-detects `<name>/`, `src/<name>/` or `<name>.py`. `dev-mode-dirs` is taken as written, and `dev-mode-exact` gives `map_module` entries.
- **setuptools**: a single `package-dir {"": d}`, a single `find.where`, or a `src/` directory gives a static `.pth`. Otherwise it writes a finder `MAPPING` of the top-level packages.
- **flit_core**: `src/` when `src/<module>` exists, else the project directory.
- **poetry-core**: each distinct `packages[].from`.
- **pdm-backend**: `package-dir`, defaulting to `src` when it exists.

Entries are sorted by the backend's `.pth` file name. site.py adds `.pth` files alphabetically, per its docstring: "bar.pth comes alphabetically before foo.pth".

Results (`results/*.derived.json` against `*.actual.json`): derived and actual entries are equal in order, and mappings equal as sets, on layouts, small, hook, envfix, attrs, click, pluggy and cleo, on 3.13 and 3.10. The `shared.py` collision resolves to `hauto` both ways (`_editable_impl_hauto.pth` sorts before `_editable_impl_pdmb.pth`), and pytest confirms it. `verified by experiment`.

**Caveat.** The rules were written while looking at the layouts fixture's output. The four real projects are the held-out check, and they cover four backends but only simple layouts.

`run-q1-cases.sh` (`results/q1-cases.txt`) varies one thing at a time on a copy of layouts:

- **Still equal**:
  - a member nothing depends on, which a plain `uv sync` does not install;
  - `[tool.uv] package = false`;
  - no `[build-system]`, so the root is not installed;
  - hatch `sources = ["src"]`, alone and with `only-include`.
- **Different**:
  - `uv sync --all-packages` adds the unreachable member's root;
  - `--no-install-project` drops `src`;
  - `--no-editable` drops every root and installs copies;
  - setuptools with two `find.where` writes a finder `MAPPING` where the probe derived nothing (a rule gap, fixable).

`verified by experiment`.

**What files cannot say.**

- Which local projects a non-uv user installed (`pip install -e`, `poetry install --no-root`). For pluggy and cleo the probe assumed the root project.
- Flags in the human's sync command.
- Hatch build hooks and `include` globs, which select files by code.
- `setup.py`. The probe flags it and does not read it.
- A setuptools-scm version in the `.pth` name. That only orders two `.pth` files of one distribution, so it is harmless.

Sources: hatchling `builders/wheel.py` `build_editable_detection` and `default_file_selection_options`; setuptools `command/editable_wheel.py` `_select_strategy` and `_simple_layout`; pdm-backend `config.py` `_get_default_package_dir` and `editable.py`; flit_core `common.py`; poetry-core `masonry/builders/wheel.py` `_add_pth`. All are `read in source code` at the versions above. Workspace members are editable and path sources are not by default (uv docs, below). The uv_build defaults are `read in official docs`.

### Q2. Closures without an environment

`graph.mjs` is the 007-02 Node resolver. Its `--roots` mode drops `pyvenv.cfg`, the stdlib and site-packages and puts the derived roots after pytest's basedirs. It also computes candidates the way `ast_graph.py` does: absent `<loc>/<name>.py` and `<loc>/<name>/__init__.py` inside the worktree in each location before the winner. `run-q2.sh` compares per-test closures in four modes. Counts are test files out of 97, from `results/q2-3.13.txt` and `q2-3.10.txt`:

| Comparison | Closure files differ | Candidates differ |
|---|---|---|
| node with `.venv` vs node with derived roots, D4 rule | 0 | 86 |
| the same, `--sym` (a winner outside the worktree does not end the scan) | 0 | 1 (click) |
| `--sym`, plus `sys.stdlib_module_names` as the stdlib location | 0 | 0 |

Identical on 3.10 and 3.13. `verified by experiment`.

- **Why candidates differ under D4.** With an environment, `import pytest` wins in site-packages. Site-packages sits before the `.pth` roots, so `src/pytest.py` is no candidate. Without one, `pytest` is unresolved, and every root adds two candidates. The same holds for stdlib names (`os`, `json`) and for the non-editable `pathdep`.
- **Why click needs the stdlib list.** click has a `tests/typing/` directory without `__init__.py`. With no stdlib location, `typing` becomes a namespace package rooted there. `--stdlib` puts a stand-in after the basedirs, where the stdlib sits, and the difference is gone. The name lists differ by Python version: 303 names on 3.10, 290 on 3.13.
- **Cost of `--sym`** (`results/cand-cost.txt`): the median of absent paths per closure goes from 8 to 12 (layouts), 10 to 22 (small), 114 to 156 (attrs), 104 to 178 (click), 28 to 42 (pluggy) and 52 to 80 (cleo). The `--sym` set is a superset of D4's, so it never misses a re-key. Its extra paths (`src/os.py`, `src/pytest.py`) re-key spuriously only if someone creates them.
- **Timing.** A no-environment graph took 38 to 567 ms per tree, almost all of it parsing. Deriving roots took 60 ms with Node startup.

**Crossings found on the way** (`verified by experiment`, in the copied 007-02 probe):

- Its tree-sitter walk never skipped `if TYPE_CHECKING:` bodies. It compares wrapper objects (`c === n.childForFieldName(...)`), and web-tree-sitter returns a new wrapper per call. Its pattern also missed `t.TYPE_CHECKING` (click). Before the fix, cleo's closures held up to 22 extra files against `ast`. The fix compares node ids, marked `007-04 fix` in `graph.mjs`.
- `ast_graph.py` and the Node resolver disagree on candidates for frozen modules (`os`, `io`, `abc`, `__future__` on 3.13). The oracle sees no location for them and scans every worktree location. Node finds the stdlib file and stops there. The interpreter runs `FrozenImporter` before `PathFinder`, so no sys.path file can shadow them, and both over-include. `inferred` from `sys.meta_path` order.

### Q3. The lockfile as the environment hash

- **One lock, several installed sets** (`run-q3-lock.sh`, `results/q3-lock.txt`). Same `uv.lock` hash `983c765166b6`:
  - Default on 3.13: 8 distributions.
  - On 3.10: 11 (`exceptiongroup`, `tomli`, `typing_extensions` by marker).
  - `--no-dev`: 2.
  - `--extra yaml`: +`pyyaml`.
  - `--all-groups`: +`six`.
  - `uv pip install six` after a default sync: +`six`.

  `uv sync --check` with default flags exits 0 for the first two and 1 for the other four, so it detects selection and hand installs. The lock records `colorama` with `sys_platform == 'win32'` and installs it nowhere here. `verified by experiment`.
- **Path sources** (`results/q3-pathdep.txt`). After an edit to `vendor/pathdep`, the lock was unchanged. `uv lock --check` exited 0 and so did `uv sync --check`, and `uv sync` kept the old copy (`VALUE = 1`) until `--reinstall-package pathdep`. uv docs: it rebuilds directory dependencies only when `pyproject.toml`, `setup.py` or `setup.cfg` changes ("a heuristic"). Two worktrees with one lock can therefore hold different copies, depending on when each synced. `verified by experiment; read in official docs`.
- **Which interpreter** (`results/q3-python.txt`). With 3.10 and 3.13 installed and no pin, `uv sync` took 3.13. uv prefers "newer versions first" among managed installations. `.python-version` 3.10 was honoured, but only with config discovery on: under `UV_NO_CONFIG` uv logged "Ignoring Python version file ... due to `--no-config`" and took 3.13. `UV_PYTHON=3.10` took 3.10. The minor version is therefore in files only when a pin file exists and nothing overrides it. The patch level never is. `verified by experiment; read in official docs`.
- **D2's hash across synced worktrees** (`results/q3-worktrees.txt`). Two copies of one commit, each synced `--locked` on 3.13, agree on the interpreter path, `pyvenv.cfg` and the site-packages listing. Every editable `.pth` and every `direct_url.json` differs, because their bytes are `<worktree>/src` and `file://<worktree>`. As written, spec D2 gives each worktree its own environment hash, so goal 2 inheritance fails even with both synced. Hashing those files with the worktree root replaced by a placeholder would make them equal. `verified by experiment` (the difference); `inferred` (the fix).

**What a stand-in must cover.** To match what a sync installs, it must cover:

- the lock bytes;
- the Python implementation and minor version, from a pin file;
- the platform;
- the sync selection (groups, extras, `--no-dev`, `--all-packages`);
- the content of every in-worktree non-editable path source.

Even then, hand installs and stale path copies make the real set differ. The real set is known only once the environment exists, and only `uv sync --check` (a tool call, 51 ms in 007-03) or a Node reimplementation of marker and group selection (not measured) can compare it with the lock. `poetry.lock` and `pdm.lock` were not probed.

## Recommendation for Squeal

1. **`affected` without an environment: yes.** Resolve from the derived roots. Closures equalled the synced ones on 97 of 97 files on both Pythons, at the cost of a normal cold build. When the environment appears, `pyvenv.cfg` is already an invalidation trigger (D5) and the resolver re-resolves.
2. **Closure half of a key: yes, if both modes use one candidate rule.** Adopt `--sym` for every worktree, synced or not: a winner outside the worktree does not end the candidate scan. Bundle `sys.stdlib_module_names` per supported minor as the stdlib location when no environment exists. A synced and an unsynced worktree then compute identical closure hashes.
3. **Environment half: no stand-in hash.** An unsynced worktree inherits only through a record. When a synced worktree's environment verifies against its lock, it records that the lock bytes plus its pin, selection and path-source content produced environment hash E. A fresh worktree with the same inputs looks up E and reads results keyed by E. When its own environment appears, its real hash replaces the lookup. A different hash leaves the inherited verdicts behind, since they were never stored under it. This needs D2's hash made worktree-relative first (Q3), which goal 2 needs anyway. With no pin file, or a sync flag Squeal cannot see, the project stays `unknown` as D2 says now.
4. **Fixture tests that would prove it**:
   - Derived roots equal actual roots for `fixtures/layouts` on 3.10 and 3.13, including the `shared.py` order.
   - Every small-fixture and layouts test file has equal closure files and `--sym` candidates with and without `.venv`.
   - A worktree directory named like a stdlib module (`tests/typing/`) does not capture the import without an environment.
   - Two copies synced from one lock have equal worktree-relative environment hashes.
   - The lookup inputs differ for 3.10 against 3.13, for `--extra`, and for an edited non-editable path source.
   - No pin file means `unknown`.

## Open questions

1. Whether to fix D2 by hashing `.pth` and `direct_url.json` worktree-relative, or by hashing the resolved roots instead. This is the coordinator's call, and goal 2 depends on it either way.
2. Whether Squeal may run `uv sync --check` to verify a lock record (a tool call that writes nothing, against D2's non-goal of tool discovery), or must evaluate `uv.lock` markers and groups in Node. Not determined, because the Node reimplementation was not built.
3. `poetry.lock` and `pdm.lock` as record inputs. Not determined, because Poetry and PDM were not run.
4. The derivation's reach beyond simple layouts: hatch build hooks, `include` globs, `setup.py`, and namespace packages split across roots. Not determined, because no real project of those kinds was cloned. A dogfooding row should log every root mismatch the daemon sees when an environment appears.
5. Frozen and built-in modules can never be shadowed. A candidate rule that knows this would drop paths both graphs now over-include. Not measured.

## Sources

- uv, Managing dependencies ("An editable installation is not used for path dependencies by default"; "Workspace members are always editable"; the `dev` group synced by default): https://docs.astral.sh/uv/concepts/projects/dependencies/ (fetched 2026-10-14)
- uv, Locking and syncing (`--no-install-project`, `--no-editable`, `--locked`, `--frozen`): https://docs.astral.sh/uv/concepts/projects/sync/ (fetched 2026-10-14)
- uv, Workspaces (`members` and `exclude` globs): https://docs.astral.sh/uv/concepts/projects/workspaces/ (fetched 2026-10-14)
- uv, Caching (directory dependencies rebuilt only on `pyproject.toml`, `setup.py` or `setup.cfg` changes, "a heuristic"): https://docs.astral.sh/uv/concepts/cache/ (fetched 2026-10-14)
- uv, Python versions (`.python-version` lookup, "prefer newer versions first", `--no-config` disables pin files): https://docs.astral.sh/uv/concepts/python-versions/ (fetched 2026-10-14)
- uv, Build backend (`module-root` default `src`, module name normalisation): https://docs.astral.sh/uv/concepts/build-backend/ (fetched 2026-10-14)
- Hatch, Build configuration (`packages`, `sources`, `only-include`, `dev-mode-dirs`, `dev-mode-exact`): https://hatch.pypa.io/latest/config/build/ (fetched 2026-10-14)
- setuptools, Development mode ("no guarantee of which technique will be used"): https://setuptools.pypa.io/en/latest/userguide/development_mode.html (fetched 2026-10-14)
- Source read from uv's cache in the probe: hatchling 1.32.4, setuptools 84.0.0, pdm-backend 2.5.0, flit_core 3.12.0, poetry-core 2.5.0 (the files named under Q1); CPython 3.10.20 and 3.13.14 `site.py` docstring
- Projects: https://github.com/python-attrs/attrs (25.4.0), https://github.com/pallets/click (8.3.0), https://github.com/pytest-dev/pluggy (1.6.0), https://github.com/python-poetry/cleo (2.1.0)
- Earlier findings: `python-module-graph.md` Q1, Q5 and open question 2; `python-environments.md` 3 and 4; spec 007 D2, D4 and D5
