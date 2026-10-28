# Research: pep582-environments (007-57)

Topic `pep582-environments` of `research/README.md`. Run on 2026-10-28 on Linux x86_64 with CPython 3.10.20 and 3.13.14 (uv-managed, under the probe folder), PDM 2.29.4, pytest 9.2.0, pytest-xdist 3.8.0, pytest-django 4.14.0, pytest-mock 3.17.0, Django 5.2.18, Node 24.22.1. Probes are in `probes/pep582-environments/` (throwaway, see its README); output is in its `out/`. The one-minute load average on 24 CPUs is printed per run: 7.3 to 26.2, as named below. The real case is `saas-bp-management-dashboard` at `b36f7150`. It was read only: no pdm, pytest, project Python or docker ran there.

## Questions answered

| # | Short answer | Tag |
|---|---|---|
| 1 | `pdm run` puts PDM's own `sitecustomize.py` first on `PYTHONPATH` and names `__pypackages__/X.Y` in `PEP582_PACKAGES`. That file runs `site.addsitedir(lib)`, so `.pth` files run, between the stdlib and the base site-packages. One plain command line gives the same `sys.path`, distributions, `pytest11` entry points and plugins: `PYTHONPATH=<dir with such a sitecustomize> PEP582_PACKAGES=<__pypackages__/X.Y> NO_SITE_PACKAGES=1 <interpreter> -m pytest`. `PYTHONPATH=lib` (the dashboard's Dockerfile) runs no `.pth`, so the project's own editable install is missing. | verified by experiment; read in source code |
| 2 | Entry-point plugins load from `lib`. `-p squeal_pytest` works. xdist workers copy the controller's `sys.path`. Child processes inherit the paths only through the environment, and `PEP582_PACKAGES` does not check the Python version. Squeal's observed-imports hook counts every `lib` file as a project file. | verified by experiment; read in source code |
| 3 | The interpreter is outside the worktree by construction. The installed set is `lib/*.dist-info`, and `pdm.lock` matches it up to platform and Python-version markers. PDM takes no lock on `__pypackages__`, and no PDM command reports "behind the lock" by exit code. Squeal notices a change only through a fingerprint. | verified by experiment; read in source code |
| 4 | A fresh worktree has no `__pypackages__`. Without `PEP582_PACKAGES`, PDM's hook walks up into the parent checkout and imports its code. `pdm run` there picks the first interpreter on `PATH`. | verified by experiment |
| 5 | No. The resolver reads site-packages only from `<env>/pyvenv.cfg`, so a PEP 582 project resolves like one with no environment. This misses PDM's editable path dependencies. `lib` read as an environment fixes that; `lib` read as a project directory multiplies closures by 40. | verified by experiment; read in source code |
| 6 | PEP 582 was rejected on 2023-03-28. PDM keeps it but recommends virtual environments. 25 public repositories set `use_venv = false`, 14 of them copies of the dashboard's boilerplate. | read in official docs; verified by experiment (code search) |
| 7 | Keep the refusal for now. Improve its note to name `PDM_USE_VENV=true pdm install`. Build native support only together with 007-58, since the dashboard's backend tests also need its compose database. The smallest sound design is below. | inferred |

## Findings

### Q1. How PEP 582 imports work, and a plain equivalent

- **Mode.** PDM uses `__pypackages__` when `python.use_venv` is false, or when the saved interpreter is not a virtual environment (`pdm use`: "Using __pypackages__ because non-venv Python is used"). An empty `__pypackages__` directory also turns the mode on (PDM docs). Packages go to `__pypackages__/X.Y/{lib,bin,include}`, and PDM writes `__pypackages__/.gitignore` (`*`). `pdm.toml` holds the setting; `.pdm-python` holds the interpreter's absolute path. *read in source code (`project/core.py`, `environments/local.py`); verified by experiment (`out/1-install.txt`).*
- **`pdm run`.** It prepends `<pdm>/pep582` to `PYTHONPATH` and sets `PEP582_PACKAGES=<root>/__pypackages__/X.Y`. It sets `PATH` to `__pypackages__/X.Y/bin`, then the user's `PATH`, then the interpreter's directory. For a `python` command or a `bin` script, it also sets `NO_SITE_PACKAGES=1`. *read in source code (`environments/local.py` `process_env`, `cli/commands/run.py` 309–319).*
- **The hook.** PDM's `sitecustomize.py` does five things in order:
  1. It runs the next `sitecustomize` on the path.
  2. It finds `lib`: from `PEP582_PACKAGES`, else by walking up from `argv[0]`'s directory and from the cwd for `__pypackages__/X.Y/lib`.
  3. It removes the base site-packages from `sys.path`.
  4. It calls `site.addsitedir(lib)`, which runs `.pth` path lines and `import` lines.
  5. It appends the base site-packages again, unless it can pop `NO_SITE_PACKAGES` from `os.environ`. A process's children therefore get them back.

  `pdm --pep582 bash` prints only `export PYTHONPATH=<pdm>/pep582`, so the global mode always walks up. *read in source code; verified by experiment (`out/6-worktree.txt`).*
- **The project's own install** is an editable `.pth` path line in `lib` (`_editable_impl_app.pth` → `<worktree>/src`) plus a `direct_url.json` with `editable: true`. The same holds for the path dependency `packages/lib`. The dashboard's workers have `sb_workers.pth` → the workers directory. Its backend (`name = ""`) installs no project. *verified by experiment (`out/1`, `out/5`).*
- **Command lines compared** (`run-2-paths.sh`, `out/2-paths.txt`, `out/2-compare.txt`, `out/8-base-site.txt`). Each ran the 8-test fixture on 3.13 and 3.10 against `pdm run python -m pytest`:

  | Command line | Result | Difference from `pdm run` |
  |---|---|---|
  | PDM's hook + `PEP582_PACKAGES` + `NO_SITE_PACKAGES=1` | 8 passed | none in `sys.path` entries, distributions, `pytest11` or plugins |
  | A PDM-free stand-in (`boot/sitecustomize.py`: remove site-packages, `addsitedir(lib)`, re-add) | 8 passed | base site-packages at the tail (here only `pip`) |
  | `PYTHONPATH=lib` (the dashboard's Dockerfile) | collection error, `No module named 'app'` | `.pth` not run; `lib` before the stdlib |
  | `python -c "site.addsitedir(lib); pytest.console_main()"` | 2 failed | the child-process tests lose `lib` |
  | `-I` | `No module named pytest` | `-I` ignores `PYTHONPATH` |

  `-S` skips `site`, so it runs neither a `sitecustomize` nor `.pth` files. *verified by experiment; `-S` inferred from the `site` docs.*
- **Base site-packages.** A `pytest11` plugin placed in the interpreter's own site-packages was not loaded under `pdm run`, with or without `-n 2`. It was loaded under the stand-in, in the controller and in both xdist workers. This is the dashboard Dockerfile's comment: "platformdirs>=4.12 registers a pytest11 plugin that the older platformdirs in `__pypackages__` ... cannot import". *verified by experiment (`out/8-base-site.txt`).*

### Q2. pytest under that command

- **Plugins.** Under every variant that puts `lib` on `sys.path`, the `pytest11` list and the loaded plugins equal `pdm run`'s: django, xdist, xdist.looponfail and pytest_mock in the fixture. The dashboard's backend lib declares 11 `pytest11` entry points; its workers lib declares 6 (`out/5`). *verified by experiment.*
- **Squeal's runtime.** `-p squeal_pytest` from `src/runners/pytest/runtime` on `PYTHONPATH` passed 8 of 8 on both Pythons (`out/3-pytest.txt`). Python imports only the first `sitecustomize`:
  - Squeal's first, the stand-in after: 8 `spawned` records.
  - PDM's first, Squeal's after: 8 `spawned` records, since PDM chains to the next one.
  - A stand-in that does not chain, first: 0 records. Squeal's recorder is then off without any sign.

  *verified by experiment.*
- **xdist.** pytest-xdist 3.8.0 sends the controller's `sys.path` to local workers (`xdist/workermanage.py` 348, `remote.py` 405–414). So under `-n 2`, workers had `lib`, `src` and `packages/lib/src` with every variant, and the base site-packages only when the controller had them (`out/8b-workers.txt`). Squeal passes `-n 0` (D6), so this concerns only a project's own child pytest. *verified by experiment; read in source code.*
- **Child processes.** They inherit `PYTHONPATH` and `PEP582_PACKAGES`. `PEP582_PACKAGES` names the directory without a Python version. Under `pdm run` in the 3.10 project, a test's `python` from `PATH` was the system 3.12, and it imported Django from `__pypackages__/3.10/lib`. Pure-Python modules load across minors; compiled ones would not (inferred). The interpreter's directory is last on `PATH` under `pdm run`. It holds `python`, `pip` and `pip3`, so putting it first would expose the base `pip` (dashboard backend interpreter, `ls`). *verified by experiment (`out/3-pytest.txt`, last line).*
- **Observed imports (007-55).** `squeal_pytest._project_file` and the `sitecustomize` recorder drop only paths under `sys.prefix`, `base_prefix` and `exec_prefix`. `__pypackages__` lies inside the worktree and under none of them. As a result:
  - 1,890 of 1,894 `import` records of a run named `lib` files (`out/3-pytest.txt`).
  - A test with `from django.core.mail import send_mail` reached 232 paths, 227 of them under `__pypackages__` (`out/3c-django-closure.txt`, the walk `observed.ts` does).

  Today's code would key such test files by installed Django files. *verified by experiment; read in source code.*

### Q3. Environment identity

- **Interpreter.** PEP 582 needs an interpreter outside any virtual environment, so it lies outside the worktree. In the dashboard:
  - The backend's `.pdm-python` names uv's minor-version link `~/.local/share/uv/python/cpython-3.11-linux-x86_64-gnu/bin/python3.11`; its real path is `cpython-3.11.15-...`. The file is untracked.
  - The workers' `.pdm-python` names a PDM-installed `~/.local/share/pdm/python/cpython@3.11.17/bin/python3`. The file is tracked, and its committed content is the Docker image's `/usr/local/bin/python`.

  All 71 and 13 text scripts in `bin` carry the interpreter's absolute path in their shebang. When the path is long, it is a `/bin/sh` wrapper (`out/1`, `out/5`). There is no `pyvenv.cfg`; the minor is the directory name `X.Y`. *verified by experiment.*
- **Installed set and lock** (`lockcheck.py`, `out/4`, `out/5`):
  - Backend: 259 locked names against 254 `.dist-info`. The 5 missing ones (`colorama`, `pywin32`, `brotlicffi`, `async-timeout`, `u-msgpack-python`) look like platform or version markers (inferred).
  - Workers: 54 against 54 plus the project itself.
  - Fixture: 18 locked names; 3.13 lacks 5 and 3.10 lacks 2, each by marker.

  *verified by experiment.*
- **What PDM rewrites** (`snap.py` before and after, `out/4-identity.txt`):

  | Command | Time | Files rewritten |
  |---|---|---|
  | `pdm install`, `pdm sync`, no-op | 1.3 s and 2.4 s | each editable install's `.dist-info` and `.pth`, same bytes, new inodes |
  | `pdm add --no-sync six` | 1.0 s | `pyproject.toml` and `pdm.lock` only |
  | `pdm sync` after that | 1.5 s | adds the distribution |
  | `pdm remove six` | 1.8 s | both files and `lib` |
  | `pip install --target lib` by hand | 1.4 s | adds a distribution outside the lock |
  | `pdm sync --clean` | 1.4 s | removes it |
  | `pdm use` | 0.5 s | `.pdm-python`, `.python-version` and the `bin` shebangs |
  | `pdm config -l` | — | the tracked `pdm.toml` |

  In the dashboard's main checkout, `git diff` shows that a local install moved the tracked workers `pdm.lock` to lock format 4.5.1 (`cross_platform`) and rewrote `.pdm-python` (`out/5`, cause inferred). *verified by experiment.*
- **No install lock, no check exit code.** PDM takes file locks only around its cache (`models/cached_package.py`, `environments/base.py` 78), never around `__pypackages__`. `pdm sync --dry-run` writes nothing (0.7 s) and exits 0 both in sync and behind the lock; only its text says "Packages to add". `pdm lock --check` compares the lock with `pyproject.toml`, not with `lib`. *read in source code; verified by experiment.*
- **Noticing a change.** No file plays the role of `pyvenv.cfg`. A fingerprint over these inputs, read before and after a run as D2 does, catches every rewrite above that changes bytes:
  - the `lib` listing;
  - each `.pth` and `direct_url.json`;
  - the bytes of `.pdm-python`;
  - the interpreter's real path and stat.

  `__pypackages__` is gitignored (dashboard root `.gitignore`:50). *inferred from the snapshots.*

### Q4. Worktrees

- **Walking up.** A worktree nested in the main checkout, without its own `__pypackages__`, ran PDM's hook without `PEP582_PACKAGES`. It imported `app` from the main checkout's `src`, through main's `lib` and its `.pth` (`out/6-worktree.txt`). This is defect 12 of spec 001 again. With `PEP582_PACKAGES` naming the worktree, the import failed as it should. In the dashboard layout (`packages/backend/__pypackages__`), the walk from a worktree does not pass the main checkout's project directory (inferred). *verified by experiment.*
- **`pdm run` in a fresh worktree** with no `.pdm-python` saved `/usr/bin/python` (system 3.12, first on `PATH`), not main's 3.13. It created `__pypackages__/.gitignore`. A following `pdm install` filled `__pypackages__/3.12` with 4,215 module files in 4.1 s. The editable `.pth` files name the worktree's own `src`. *verified by experiment.*
- **Writes outside the worktree:**
  - the PDM cache (`PDM_CACHE_DIR`: `hashes`, `http`, `metadata`, wheels);
  - bytecode in the interpreter's own stdlib `__pycache__` (117 files on the first 3.10 use, `out/1`);
  - PDM's own install.

  `python.install_root` defaults to `<user data>/pdm/python`; the workers' interpreter came from there. With the probe's `HOME`, no PDM path under the real `HOME` changed (`out/1`, `out/6`). *verified by experiment; defaults read in source code (`project/config.py`).*
- **`install.cache = true`** makes all 4,272 module files in `lib` symlinks into the shared PDM cache, outside the worktree; `.pth` files stay files. Setting it with `pdm config -l` writes the tracked `pdm.toml`. *verified by experiment.*

### Q5. Module graph

`searchPath` (`graph/search-path.ts`) and `importRoots` read site-packages only through `<env>/pyvenv.cfg` and `<env>/lib/pythonX.Y/site-packages`. A PEP 582 project is therefore "derived": it has the stdlib names, the cwd and the roots from `pyproject.toml`. `run-7-graph.sh` ran `createPytestGraph` from files (`out/7-graph.txt`):

| Tree | `lib` absent (today) | `lib` as a venv-shaped environment | `lib` as a `pythonpath` directory |
|---|---|---|---|
| fixture, 2 files | mean 18 paths, 30 ms | mean 24, 28 ms | mean 728, 646 ms, incomplete |
| dashboard backend, 250 files | mean 525, 2.5 s | equal | not run |
| dashboard workers, 1 file | 43, 50 ms | equal | 2,054 (1,715 in `lib`), 4.7 s |

- **The fixture's difference** is PDM's editable path dependency. The derived roots miss `-e file:///${PROJECT_ROOT}/packages/lib` in a PDM dependency group, since `deriveRoots` reads uv workspaces and `[tool.uv.sources]` only. Both test files then lack `packages/lib/src/lib/*.py` (`graph-diff.ts`). The dashboard has no such dependency, and its two layouts resolve through the cwd. *verified by experiment.*
- **The backend's closures are all incomplete**, through two computed imports (`apps/multitenancy/permissions.py:51`, `common/graphql/acl/utils.py:12`). This is unrelated to PEP 582. *verified by experiment.*
- **What `no-venv-resolution.md` settles.** Closures without an environment equal the synced ones for every layout the derivation reads (97 of 97), so the closure half of a key is sound now. The environment half needs a real environment; the human decided on 2026-10-15 against a lock-to-environment record (`status.md`). It does not settle PDM path dependencies or `pdm-pep517` (the dashboard's legacy backend; derivation notes it as unread).

### Q6. Prevalence

- PEP 582 is "Status: Rejected". The Steering Council wrote on 2023-03-28 that "the SC has decided to reject PEP 582 ... at least in its current form", because "the consequences in semantics are not immediately apparent, in particular when combining with other ways to affect the module search paths (virtual environments, user-local installs, PYTHONPATH, .pth files, sitecustomize, etc)". *read in official docs.*
- PDM's docs: "PEP 582 has been rejected ... PDM will retain the support. We recommend using virtual environments instead." *read in official docs.*
- **GitHub code search on 2026-10-28:**
  - `"use_venv = false" filename:pdm.toml`: 38 files in 25 repositories. 14 of them are copies of Apptension's SaaS boilerplate (`packages/backend`, `packages/workers`), the dashboard among them. 7 are one organisation's (open-nudge). The rest are ceph-nvmeof and a mirror of it, and 2 others.
  - `"@generated by PDM" filename:pdm.lock`: 7,232 files.
  - `use_venv` in any form: 74 repositories.

  Code search covers default branches and only some forks, and it cannot see a user-level `pdm config python.use_venv false`. *verified by experiment (`gh api search/code`).*

### Q7. Evidence for the recommendation

- **A narrower stand-in exists today.** In a fresh nested worktree, `PDM_USE_VENV=true pdm use -f <python>` followed by `PDM_USE_VENV=true pdm install` made `.venv/pyvenv.cfg` in 4.0 s, created no `__pypackages__` and changed no tracked file (`pdm.toml` still says `use_venv = false`). `.pdm-python` named `.venv/bin/python`, and a later plain `pdm run` used that `.venv`. With `.venv/bin` first on `PATH`, as D2 does, 8 of 8 passed (`out/9-venv-override.txt`). Squeal's current D2 supports this environment unchanged. One caveat: in the dashboard's workers, `.pdm-python` is tracked, so `pdm use` would modify a tracked file. *verified by experiment.*
- **The dashboard needs more than imports.** The backend's `.test.env` sets `DB_CONNECTION` host `db`, the compose service name. Its root `conftest.py` has a session `autouse` fixture on `django_db_setup`. Host runs therefore need the database reachable as `db`, which is 007-58's topic. The workers have 1 test file. *read in the dashboard's files; inferred.*

## Recommendation for Squeal

1. **Keep the refusal now; improve its note.** PEP 582 is rejected, PDM itself recommends virtual environments, and 25 public repositories use it, most of them one boilerplate. The note should name the stand-in that works today: `PDM_USE_VENV=true pdm install` in `<cwd>`, which creates a per-worktree `.venv` without editing `pdm.toml`. Check the dashboard's own install (weasyprint and other system libraries) on a host before the note promises it; this was not tried.
2. **Decide native support together with 007-58.** For the dashboard's 250 backend files, native support alone turns "unknown" into database errors.
3. **If native support is built, the smallest sound design**, each part backed by a finding above:
   - **Discovery, files only.** `pdm.toml` `use_venv = false`, or a `__pypackages__` directory. The interpreter comes from `.pdm-python` or a declared `python`. It is allowed outside the worktree only when it is not inside another worktree and its minor equals an existing `__pypackages__/X.Y/lib`. Otherwise the project is "no environment" with a note naming `pdm install`.
   - **Run.** Squeal's own `runtime/sitecustomize.py` does PDM's steps itself when told `lib`: remove the base site-packages, `site.addsitedir(lib)`, re-add the base site-packages only if PDM parity is not wanted. It does this before chaining, in every process, so children and xdist workers get it. Never use PDM's file, `PYTHONPATH=lib` or an in-process wrapper. Put `__pypackages__/X.Y/bin` first on `PATH`. Give children the interpreter through a Squeal-owned directory holding only a `python` link, not the interpreter's own `bin` with `pip` (Q2).
   - **Recorders.** Add `lib` to the paths that `squeal_pytest._project_file` and the `sitecustomize` recorder drop (Q2: 227 of 232 paths).
   - **Graph.** Read `lib` as site-packages: a resolved path there ends the walk, its `.pth` lines are roots, and the stdlib comes from the interpreter's minor (Q5).
   - **Environment hash.** D2's inputs with `lib` in the place of site-packages, plus the bytes of `.pdm-python`. Use the interpreter's real path and `sys.version`, asked once with `-I -S`. Apply the editable-outside rule to `lib/*.dist-info/direct_url.json`.
   - **Fixture tests that would prove it:**
     - the fixture passes 8 of 8 on 3.10 and 3.13, with 0 observed paths under `__pypackages__`;
     - a nested worktree without `__pypackages__` is "no environment" and never imports main's `src`;
     - a `.pdm-python` of another minor than `__pypackages__/X.Y` is refused;
     - `pdm add six` followed by `pdm sync` re-keys, and a no-op `pdm install` does not;
     - a run overlapping `pdm sync` stores nothing;
     - a test's child `python` is the project interpreter;
     - a `pytest11` plugin in the base site-packages does not load;
     - a PDM editable path dependency is in the closure.

## Open questions

1. Base site-packages: PDM parity (drop them in the pytest process; children get them back) or always drop them. Not determined, because it is a product choice. The Dockerfile case shows that the two choices give different verdicts.
2. Whether `deriveRoots` should read PDM dependency groups' `-e file:///${PROJECT_ROOT}/...` entries for every PDM project, not only PEP 582 ones. Not determined, because only the fixture has one.
3. The dashboard's install into a host `.venv` (system libraries for weasyprint, `pdf2image`). Not determined, because no install ran there.
4. `install.cache = true` puts `lib`'s files in a cache shared by every worktree. Whether the hash should read through the links. Not determined, because no test changed a cached file.

## Sources

- PEP 582, Python local packages directory (Status: Rejected): https://peps.python.org/pep-0582/ (fetched 2026-10-28)
- Steering Council decision, 2023-03-28: https://discuss.python.org/t/pep-582-python-local-packages-directory/963/430 (fetched 2026-10-28)
- PDM docs, Working with PEP 582: https://pdm-project.org/en/latest/usage/pep582/ (fetched 2026-10-28)
- PDM 2.29.4 source in `probes/pep582-environments/scratch/tools/.venv`: `pep582/sitecustomize.py`, `environments/local.py`, `environments/base.py`, `cli/commands/run.py`, `cli/commands/use.py`, `cli/utils.py` `get_pep582_path`, `project/core.py`, `project/config.py`
- pytest-xdist 3.8.0 `xdist/workermanage.py`, `xdist/remote.py` (from the fixture's `lib`)
- GitHub code search API, queries above, run 2026-10-28
- Squeal: `src/runners/pytest/environment/{discover,states,import-roots,site}.ts`, `graph/search-path.ts`, `runtime/sitecustomize.py`, `runtime/squeal_pytest.py`, `run/run.ts`
- Dashboard (read only): `packages/{backend,workers}/{pdm.toml,.pdm-python,pyproject.toml,setup.cfg,pdm.lock,Dockerfile,project.json,.test.env}`, `__pypackages__/3.11` listings, root `.gitignore`, `squeal.config.json`
- Earlier findings: `python-environments.md` 1 to 3, `no-venv-resolution.md` Q1 to Q3, spec 007 D2, D4 and D6, `status.md` 2026-10-15 and 2026-10-28
- Probes: `probes/pep582-environments/run-0-tools.sh` to `run-9-venv-override.sh`; output in `out/`
