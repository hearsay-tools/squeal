# Research: tests-in-docker (007-58)

Topic `tests-in-docker` of `research/README.md`. Run on 2026-10-28 on Linux x64 (24 CPUs), Docker server 28.5.1, Compose 5.6.1. Probe image: python:3.11-slim-bookworm, CPython 3.11.18, pytest 8.4.2, psycopg 3.2.10; database postgres:16.1-alpine; host comparison uv's CPython 3.11.15 with pytest 8.4.2. One-minute load 9.6 to 26.2, printed per run in `probes/tests-in-docker/out/`. The real case, `~/projects/saas-bp-management-dashboard` at `b36f7150`, was read only; `docker compose config` was the only command run there.

Docker access: the agent's process is not in the `docker` group and the socket is `srw-rw---- root docker`, so `docker ps` fails with `permission denied ... /var/run/docker.sock` (verified by experiment) and every probe ran as `sg docker -c "..."`. A Squeal daemon started from such a session inherits its groups and gets the same refusal (inferred from the socket mode).

## Questions answered

| # | Short answer | Tag |
|---|---|---|
| 1 | Patterns: a fresh container per command (`compose run --rm`), `exec` into a running service, the whole tool in a devcontainer, tests on the host with services in containers, tests that start containers (Testcontainers). The dashboard uses `compose run --rm` for both Python packages. Its backend can reach a compose Postgres from the host through `DATABASE_URL`; a full host run also needs 007-57's environment, and the image's system libraries on the host are not determined. | read in source code; host-to-Postgres verified by experiment |
| 2 | Per batch: `exec` 0.43 s median, as fast as the host (0.59 s); `run --rm` 1.94 s; a cold `run` that starts Postgres 4.1 s. The mount shows the worktree the compose file's directory, or an inherited `COMPOSE_FILE`, names. Squeal's plugin works when mounted and appended to the image's `PYTHONPATH`; absolute paths need a map. Containers write root-owned files. A killed client never stops its container. | verified by experiment |
| 3 | Fixed host ports, `container_name`, a shared external volume, same-named project directories and one test database name collide. Per-worktree project names (the dashboard's overlay) and a per-batch database suffix isolate. | verified by experiment; dashboard by `config` and source |
| 4 | Key by the image ID the run uses, the service's `config --hash`, the dependency images' IDs and the compose and `.env` bytes. Local builds have no digest. A rebuild changes the image ID, not the config hash; a running service keeps its old image until recreated. | verified by experiment |
| 5 | Docker access is root. The dashboard's own `compose run backend` starts a privileged container holding the host's Docker socket. Squeal should start nothing without declared policy, build nothing, and remove only what it labelled. | read in official docs; dashboard verified by `config` |
| 6 | PyCharm: a Compose service as interpreter, paths mapped by hand on Linux. VS Code: the tool runs inside. Testcontainers: label-and-reap. Turborepo: builds images only. Nx: declared inputs. testmon: records the environment it runs in. | read in official docs and source code |
| 7 | Do not run containers yet: give the dashboard 007-57 plus a reachable Postgres and a per-batch database name. If containers are wanted, add one opt-in mode: `compose run --rm --no-deps` per batch against running services, keyed by image ID, labelled and reaped. | inferred from 1 to 6 |

## Findings

### Q1. Patterns, and the dashboard

The backend's `test` target runs `docker compose run --rm -T -e PYTEST_WORKERS -e PYTEST_SHARD backend ./scripts/runtime/run_tests.sh`; workers run `compose run --rm --entrypoint /bin/bash workers .../run_tests.sh`. Both depend on `compose-build-image`. `run_tests.sh` also runs `ruff`, `black` (which rewrites files outside CI) and `makemigrations --check` before `pytest --create-db -n auto --cov`, so a runner would call pytest, not the script. (read in source code)

What a container sees depends on the compose files in force. Neither the main checkout nor its four Cezar worktrees has a `.env`, so `COMPOSE_FILE` is unset and only `docker-compose.yml` applies: `backend` has **no source mount** and the image name `/backend` (`out/00-dashboard-config.txt`), so it would test the code `COPY . /app` baked in. `scripts/worktree-init.sh` would write a per-worktree `COMPOSE_PROJECT_NAME` and an absolute `COMPOSE_FILE` with the overlay, but its guard `*saas-boilerplate*` does not match this checkout's name and it exits (read in source code). The local file set also needs `packages/backend/.env`, which is missing; `config` fails (verified by experiment).

Host tests against the compose Postgres:

- pytest-dotenv 0.5.2 loads `.test.env` with `override=True`, so its `DB_CONNECTION` (host `db`) beats the environment; `config/settings.py` reads `DATABASE_URL` first, and `DB_PROXY_ENDPOINT` overrides the host; neither is in `.test.env` (read in source code).
- A host pytest reached the probe's Postgres through a published port and through the bridge IP with no published port, about 0.8 s per run; the name `db` does not resolve on the host (verified by experiment, `out/07`).
- The root `conftest.py` swaps Redis for in-memory layers and mocks S3 with moto, so most backend tests need only Postgres (read; inferred for the suite). The image installs `poppler-utils`, `libpango`, `libcairo` and pins `platformdirs<4.12`; whether the host matches is not determined, because running the dashboard's tests was not allowed.
- Workers take `DB_CONNECTION` from compose's `env_file`; `db_session` runs `create_all`/`drop_all` on that one database per test (read in source code).

### Q2. Squeal's runs inside a container

One batch (one file, 3 tests, pytest 0.06 s), five runs each at load 23 to 26 (`out/02`):

| Way | ms (min to max, median) | Overhead alone (`true`) |
|---|---|---|
| host `.venv` | 426 to 662, 589 | none |
| `compose exec -T`, service running | 396 to 552, 432 | 105 to 132 |
| `docker run --rm` on the project network | 795 to 1907, 855 | not measured |
| `compose run --rm -T`, dependencies running | 1453 to 2319, 1938 | 946 to 1136 |
| `compose run --rm -T`, Postgres cold (3 runs) | 3957 to 4119 | none |

At D6's batch size 5 and tier size 4, `run --rm` adds about 1 s per tier (inferred).

Verified by experiment (`out/03`, `out/05`):

- **Worktree.** Relative bind sources resolve against the first compose file's directory. Run from worktree `b` with an inherited `COMPOSE_FILE` naming `x/app`'s file, the run tested `x/app`'s code (1 failed, 2 passed, where `b` gives 3 failed).
- **Plugin.** The runtime folder mounted read-only works, `sitecustomize.py` included (`spawned` records from a child). `-e PYTHONPATH=/squeal` *replaces* the image's value: `No module named pytest`. Appending to it (`/deps:/work/src:/squeal`) works. The dashboard image sets `PYTHONPATH=/pkgs/__pypackages__/3.11/lib` in `ENV`, so Squeal must read the effective value from the image's `Config.Env` and the service's `environment`.
- **Paths.** Node IDs and `location.path` are rootdir-relative and unchanged; every absolute path in the events is a container path (`/work/src/app/core.py`) and needs the mount-target-to-source map `compose config` lists.
- **Ownership.** As root (the default, and the dashboard image has no `USER`), pytest wrote root-owned `__pycache__` and events files the agent could not delete. `--user <uid>:<gid>` with `HOME=/tmp` wrote user-owned files. D6's `PYTHONPYCACHEPREFIX` would need a container path.
- **Missing sources.** A `-v` source that does not exist is created on the host as a root-owned directory (a wrong probe path made `docs/src/runners/pytest/runtime`; removed through a container). The docs: "Docker automatically creates the directory on the host for you" (read in official docs).

Signals to the client's process group, as D6's deadline sends, during a 120 s test (`out/04*`, verified by experiment):

| Case | 3 s later |
|---|---|
| `compose run --rm`, SIGTERM or SIGKILL | container running: pytest as PID 1 ignores the forwarded SIGTERM |
| `compose run --rm`, service `init: true`, SIGTERM | container gone |
| same, SIGKILL | container running |
| `compose exec`, SIGTERM or SIGKILL | client gone, pytest still running in the service |
| `docker run --rm` / with `--init`, SIGTERM | running / gone |

The docs: a PID 1 process "ignores any signal with the default action" (read in official docs). The daemon removed a leftover `--rm` container when its test ended; a hung test would keep it. Containers started with `run -l org.squeal.run=r1` were found by label and removed with `docker rm -f`.

### Q3. Parallel work

Verified by experiment (`out/05`): two worktrees `x/app` and `y/app` both default to project `app` (the docs: after `-p`, `COMPOSE_PROJECT_NAME` and `name:`, "the base name of the project directory"; read in official docs), so they would share containers (inferred; not run under a non-probe name). Cezar's UUID directories differ. A second project publishing the same port failed `port is already allocated`; a fixed `container_name` failed `Conflict`. `compose run` does not publish the service's own ports (read in official docs) but starts dependencies that do: the dashboard's `db` 5432, `redis` 6379, `stripemock`, and in the local set `localstack`, `mailcatcher`, `flower`. Two concurrent batches creating `test_app` in one Postgres: the second failed `DuplicateDatabase`; with per-batch suffixes both passed.

The dashboard's `docker-compose.worktree-overlay.yml` resets every port, renames `mcp-server` and gives each project its own Postgres volume (verified by `config` on a copy, `out/00b`). Without it the local set uses the external volume `saas-web-backend-db-data` for every worktree: two Postgres containers on one data directory (inferred hazard; not tested). pytest-django 4.12.0 suffixes test databases only by xdist `workerid` or `TOX_PARALLEL_ENV` (read in source code). Squeal forces `-n 0` (D6), so every backend batch would use `test_backend` under `setup.cfg`'s `--reuse-db` and share or drop each other's database (inferred). `TOX_PARALLEL_ENV=<batch>` would give `test_backend_<batch>`, which the template code reads (inferred). The template build and clones run under a Postgres advisory lock keyed by the migration fingerprint, so one template serves parallel batches (read in source code).

### Q4. Environment identity

Verified by experiment (`out/06`): `image inspect` gives the ID in 21 ms; a local build has no `RepoDigests`; an unchanged rebuild keeps the ID and a one-line `Dockerfile` change makes a new one. `compose config --hash` (71 ms) changes with an environment variable, not with a rebuild. A running service kept the old image after the rebuild until `compose up -d` recreated it, so `exec` tests the container's `.Image`, not the tag's. Listing the image's distributions needs a throwaway container (586 ms), but the image ID already covers what the build baked in: the dashboard's `/pkgs/__pypackages__` comes from `pdm sync` at build, so a `pdm.lock` edit changes no run until a rebuild (read in source code).

The environment hash therefore holds the image ID the run uses, `config --hash` of the test service (mounts, environment, command), the dependency services' image IDs (Postgres 16.1 changes results) and the bytes of the compose and `.env` files in force (inferred). The closure stays on the host under D4, resolved with its no-environment import roots, since no host `.venv` exists (inferred). How to notice a rebuild (polling `image inspect` per batch against `docker events`) is not determined, because only the first was measured.

### Q5. Consent and safety

The Docker docs: "only trusted users should be allowed to control your Docker daemon", since a container can mount `/` and "alter your host filesystem without any restriction"; "The `docker` group grants root-level privileges to the user" (read in official docs). In the dashboard, `compose run backend` under the local and overlay files starts `db, flower, localstack, mailcatcher, redis, stripemock, workers`, and `localstack` is `privileged: true` with `/var/run/docker.sock` mounted (verified by `config`). The probes' runs wrote root-owned files, created root-owned directories and left containers after a kill (Q2). Vision principle 8: "Anything expensive, destructive, externally visible or production-facing needs explicit policy"; spec 004: Squeal never builds anything.

So, without asking, Squeal could start only its own labelled per-batch containers of a service the policy names; never `up`, `build`, `pull`, `down` or `rm` of anything unlabelled. `squeal setup` must ask whether a project runs in a container at all, which service and files, whether Squeal may start dependencies or must find them running, and the container user, and must state that this grants Squeal root on the host (inferred).

### Q6. Prior art

- **PyCharm** offers "a remote interpreter based on Docker Compose"; "The Path mappings settings are not available on Linux ... you will have to do it manually" (read in official docs). Whether it uses `run` or `exec` per session is not determined: the fetched pages do not say.
- **VS Code Dev Containers**: "Extensions are installed and run inside the container", so the Python test explorer runs pytest with container paths; on close "the extension automatically shuts down the containers you've connected to" unless `shutdownAction` is `"none"` (read in official docs). Squeal's daemon inside a devcontainer already works without Docker support (inferred).
- **Testcontainers** starts containers from the test (`PostgresContainer("postgres:16")`); its reaper Ryuk helps "remove containers, networks, volumes and images by given filter after specified delay", filters being labels its clients send, and shuts down after `RYUK_CONNECTION_TIMEOUT` without connections (read in official docs). Lesson: label-and-reap. Such tests run on the host but need Docker access the daemon may lack (inferred).
- **Turborepo**'s Docker guide is `turbo prune --docker` for building images, not testing in them (read in official docs).
- **Nx** keys a target by declared inputs; a `runtime` input can hash a command's output (read in official docs). The dashboard's `test` target hashes files and `PYTEST_SHARD`, with no image input (read in source code), so Nx misses a base image a rebuild pulls (inferred).
- **testmon** writes `TESTMON_DATAFILE` or `.testmondata` relative to the working directory and records the Python version and installed packages of its own process; `--testmon-env` separates environments (read in source code). In a container it records the image's environment and writes into the mount as root unless `--user` (inferred from Q2).

## Recommendation for Squeal

1. **Keep test processes on the host for now.** The dashboard's blocker is its environment (007-57) and its database address, not Docker. With 007-57 and the project's `env` (D1) setting `DATABASE_URL` to a per-worktree compose Postgres on a published port (the bridge IP changes on each `up`), its backend runs with no Docker code in Squeal. Parallel batches then need a per-batch database name: either a Squeal variable per batch (`SQUEAL_PYTEST_BATCH`) that the project maps, or `TOX_PARALLEL_ENV`, which pytest-django already honours. Which one is a spec decision.
2. **If container runs are wanted, one opt-in mode.** A pytest project names a compose service and files; each batch is `docker compose -p <name> run --rm -T --no-deps --user <uid>:<gid> -l org.squeal.run=<id> -v <runtime>:ro -v <events dir> -e PYTHONPATH=<effective>:<runtime> <service> python -m pytest ...`. Required: an init process in the service (or `--init`); dependencies already healthy, else `unknown` with a note; `docker rm -f` by label after the deadline's signals; paths mapped from `config` volumes; a refusal when a bind source lies outside the worktree, as D2 refuses an outside editable; Q4's hash. Cost: about 1 s per batch over the host. `exec` is faster but tests whatever image the service runs and leaves processes on a kill.
3. **Never** build, pull, `up`, `down` or remove for a project, nor touch unlabelled resources.

Fixture tests for option 2: a batch in a compose service reports what the host run reports, locations mapped to host paths; the image's `PYTHONPATH` is kept; no root-owned file appears in the worktree; a hung test at the deadline leaves no labelled container; a rebuild re-keys every file and an unchanged rebuild none; two same-named worktrees and two concurrent batches share no database; an inherited `COMPOSE_FILE` naming another worktree is refused; a daemon without Docker access reports `unknown` with one note.

## Open questions

1. Whether the dashboard's backend passes on the host against the compose Postgres: not determined, since running it was not allowed and system libraries may differ.
2. Whether `compose run` builds a missing image by default: not verified; if so, `--pull never` and a check before the run keep Squeal from building.
3. Rootless Docker, Podman and Docker Desktop were not tested; their mount ownership and bridge reachability differ.
4. Polling `image inspect` against `docker events` for rebuilds was not compared.
5. Cost on the dashboard's real image (Django import, about 3,000 tests) was not measured.

## Sources

- Probes: `probes/tests-in-docker/run-2-start-cost.sh` to `run-7-host-to-compose.sh` and `out/`.
- Dashboard at `b36f7150`, read only: `packages/backend/{project.json,Dockerfile,scripts/runtime/run_tests.sh,TEST_DATABASE_SETUP.md,pytest_django_db_setup.py,conftest.py,setup.cfg,config/settings.py}`, `packages/workers/{project.json,Dockerfile,conftest.py,settings/base.py,setup.cfg}`, `docker-compose{,.local,.ci,.worktree-overlay}.yml`, `scripts/worktree-init.sh`, `nx.json`, `.ai/cezar/config.json`; installed `pytest_dotenv/plugin.py` 0.5.2 and `pytest_django/fixtures.py` 4.12.0 under `packages/backend/__pypackages__/3.11/lib`.
- Docker, fetched with curl because WebFetch could not reach docs.docker.com: `github.com/docker/docs` at `f90928eb`, `content/manuals/engine/security/_index.md`, `content/manuals/engine/install/linux-postinstall.md`, `content/manuals/compose/how-tos/project-name.md`, `content/manuals/engine/storage/bind-mounts.md`; `github.com/docker/cli` at `66786b77`, `docs/reference/commandline/container_run.md`; `github.com/docker/compose` main, `docs/reference/compose_run.md`.
- PyCharm: https://www.jetbrains.com/help/pycharm/using-docker-compose-as-a-remote-interpreter.html and https://www.jetbrains.com/help/pycharm/docker-compose.html (2026-10-28).
- VS Code: `github.com/microsoft/vscode-docs` at `2cbe7d69`, `docs/devcontainers/containers.md`.
- Testcontainers: `github.com/testcontainers/moby-ryuk` at `0509b379` and `github.com/testcontainers/testcontainers-python` at `6146aa11`, READMEs.
- Turborepo: `github.com/vercel/turborepo` main, `apps/docs/content/docs/guides/tools/docker.mdx`. Nx: `github.com/nrwl/nx` master, `astro-docs/src/content/docs/reference/inputs.mdoc`.
- testmon: `github.com/tarpas/pytest-testmon` at `335a8911`, `testmon/pytest_testmon.py`, `testmon/testmon_core.py`.
- Squeal: `src/runners/pytest/run/command.ts`, `src/runners/pytest/runtime/`; spec 007 D1 to D6; spec 004 non-goals; `docs/vision.md` principle 8.
