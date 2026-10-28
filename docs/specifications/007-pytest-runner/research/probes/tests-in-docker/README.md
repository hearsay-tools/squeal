# Throwaway probes for `research/tests-in-docker.md`

Throwaway. Nothing here is product code; delete it whenever the findings file no longer needs it.

- `fixture/`: a small pytest project (`src/app`, root and nested `conftest.py`, a parametrized test, a
  test that starts a Python child, a test that creates and drops a Postgres database as pytest-django
  does) with a `Dockerfile` (python:3.11-slim-bookworm, pytest 8.4.2, psycopg 3.2.10, pytest-xdist
  3.8.0) and a `compose.yml` (Postgres 16.1 `db`, a long-lived `tests` service, `tests-init` with
  `init: true`).
- `run-*.sh`: the probes. Each works on copies under `scratch/` (git-ignored). Every docker command
  runs as `sg docker -c "..."`, because the agent's process lacks the docker group. Compose projects
  are named `squeal-probe-tests-in-docker-*`; the one image is `squeal-probe-tests-in-docker/tests`.
- `out/`: the captured output each finding cites. `01-build.txt` is the image build, run by hand as `docker compose -p squeal-probe-tests-in-docker-a build tests` in a copy of `fixture/`. `00-*` are the dashboard's `docker compose config`
  (the only docker command run in `~/projects/saas-bp-management-dashboard`) and a config-only merge
  of its compose files copied into `scratch/`.

Docker host on 2026-10-28: server 28.5.1, Compose 5.6.1, 24 CPUs. It held no image, container, volume
or network of anyone else's before the probes. After them, everything they created was removed:
containers, the ten anonymous Postgres volumes, three images, the build cache. Root-owned
`__pycache__` files the containers wrote into `scratch/` were removed with `sudo -n`.
