# Research brief for spec 027: Docker execution

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `docs/decisions/0002-content-keyed-shared-store.md`, and `../status.md` first.

The human, 2026-11-26, wants Squeal to run the test suite of `~/projects/saas-boilerplate` (`https://github.com/apptension/saas-boilerplate`, public MIT repo) and specifically wants to figure out how Squeal should handle tests that run in Docker today.

This topic builds on (do NOT repeat):
- `../../007-pytest-runner/research/tests-in-docker.md` (row 007-58, 2026-10-28: per-batch `compose run`, `compose exec`, `docker run`, signals/`--init`, `--user`, path mapping, image ID keying, Docker socket safety).
- `../../021-remote-store-and-execution/spec.md` and `../../026-tiered-and-cloud-execution/spec.md` (`src/core/runner-host/remote/`: shipped remote runner-host stdio protocol, `RemoteMachineProvider` seam, `environmentMode: "remote-key"`, blob proof).
- `../../007-pytest-runner/spec.md` and `src/runners/pytest/`.

Write your findings to `research/docker-execution.md` in this folder and commit them with any throwaway probes.

## Rules for findings documents

- Length: 2 to 4 pages. Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions for the human, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code`, or `inferred`. Name commits read and tool versions with retrieval dates.
- Sources: official docs, this repository, and `~/projects/saas-boilerplate` (read-only). Do not search the open web beyond named tools' official docs. Where a source does not answer a question, write "not determined, because".
- Private material rule (`docs/styleguide.md`): never commit absolute home paths (write `~`), recorded agent session logs or transcripts, or names of private client repositories. Run `pnpm run check:private` before committing. (`saas-boilerplate` is a public GitHub repo; do NOT name other private projects on this host or running container names belonging to other projects.)
- No em-dashes. Short sentences. Data over adjectives.
- Safety for Docker and `~/projects/saas-boilerplate` probes:
  - **NEVER modify `~/projects/saas-boilerplate`**. Leave its git status and working tree completely untouched.
  - Copy only the needed subset (or clone locally) into a scratch directory under `$TMPDIR` for any experiment.
  - **NEVER touch, stop, or collide with existing containers or host port 5432** (another project's Postgres is bound to 5432 on this host). Use unique `COMPOSE_PROJECT_NAME=squeal-probe-027-<rand>`, ephemeral/non-conflicting ports (or `0:5432` / internal Docker network), and label every container/volume you create (`org.squeal.probe=027`).
  - **NEVER start `localstack` (`privileged: true` + `/var/run/docker.sock`)** in probes.
  - Always run `docker compose down -v --remove-orphans` and remove all temp probe containers, volumes, networks, images (or note reused cached base images), and `$TMPDIR` folders before finishing. Verify `docker ps -a --filter label=org.squeal.probe=027` is empty.
  - Report one-minute host load beside every local timing measurement. Skip timing measurements if load exceeds 24.
- Throwaway scripts live under `research/probes/docker-execution/` with a `README.md` marking them throwaway. Keep `node_modules`, `.venv`, and Docker build artifacts out of git.
- Do not design the full feature or edit `docs/board.md`, `spec.md`, or product code. Touch nothing outside `docs/specifications/027-docker-execution/research/`.

---

## Topic: docker-execution

Context observed in `~/projects/saas-boilerplate`:
- `packages/backend` (62 pytest files, Django 5.2, Python `>=3.11.1`, `uv`-managed with `pyproject.toml` + `uv.lock`, `setup.cfg` sets `env_override_existing_values = 1`, `env_files = .test.env`, `addopts = --tb=short -v --reuse-db`). `project.json` runs `docker compose run --rm -T backend ./scripts/runtime/run_tests.sh`. Its `Dockerfile` runs `uv sync --frozen` into `/pkgs/.venv`, installs `gcc`, `postgresql-client`, `nodejs` (Node 20), `chamber`, and sets `PYTHONPATH=/pkgs/.venv/lib/python3.11/site-packages`.
- `packages/workers` (6 pytest files, SQLAlchemy, Python `~=3.11.0`, `uv`-managed with `pyproject.toml` + `uv.lock`). `project.json` runs `docker compose run --rm --entrypoint /bin/bash workers /app/packages/workers/scripts/runtime/run_tests.sh` (`python setup.py create_db` + `pytest --cov`). `conftest.py` calls `Base.metadata.create_all` / `drop_all` on one DB per test.
- `docker-compose.yml` has NO bind mount for `backend` source (only `docker-compose.local.yml` and `docker-compose.ci.yml` bind-mount `./packages/backend:/app`), hardcodes ports (`5432`, `6379`, `5001`, `4000`) and `container_name: mcp-server`, and `docker-compose.local.yml` uses an external volume for Postgres and `privileged: true` `localstack` with `/var/run/docker.sock`.
- On this host today, `docker ps` succeeds directly for the `agent` user (unlike on 2026-10-28 when `sg docker` was required).

Questions to answer:

1. **Host pytest vs container pytest on `saas-boilerplate` (live experiments on a temp copy).**
   - For both `packages/backend` and `packages/workers`, test running a representative sample of tests (e.g. 5 to 10 backend test files including DB/Django/GraphQL/email/S3 tests, and all 6 worker test files) in two ways against a probe Postgres (and Redis if needed):
     (a) **On the host** via `uv sync` into a temp `.venv`, connecting to the probe Postgres container on an ephemeral published port. Check whether `.test.env`'s `env_override_existing_values = 1` + `DB_CONNECTION` (`host: "db"`) can be cleanly overridden (e.g. `DATABASE_URL` or `DB_PROXY_ENDPOINT` or settings reading order), whether any test needs container-only system libraries/binaries (`chamber`, `node`, email renderer, `postgresql-client`), and what passes/fails. Measure 1-file and 5-file batch wall times.
     (b) **Inside a container** built from `packages/backend/Dockerfile` (or a minimal probe image matching it if full build takes too long, noting exact build time and size) and `packages/workers/Dockerfile` with Squeal's `squeal_pytest.py` runtime mounted `:ro` and `PYTHONPATH` appended. Verify whether Squeal's pytest runtime produces clean JSON-lines events with mapped host paths and user-owned files (`--user <uid>:<gid>`). Measure 1-file and 5-file batch wall times for `compose run --rm -T --no-deps`, `docker run --rm`, and `docker exec -i`.
2. **Three execution architectures compared (for pytest AND general runners like Vitest/Jest/node:test):**
   - **(A) Host test processes + containerized dependencies + per-batch slot var (`007-60`)**: Squeal runs runners on the host as today, passes a per-batch slot ID (`SQUEAL_SLOT` and/or `TOX_PARALLEL_ENV`) for database/resource isolation, and relies on reachable dependency containers.
   - **(B) Opt-in per-batch container execution** (from `007-58` recommendation 2): Squeal invokes `docker compose run --rm -T --no-deps --init --user <uid>:<gid> -l org.squeal.run=<id> ...` (or `docker run --rm` on the project network) per batch against already-running dependencies.
   - **(C) Container as a Squeal runner host (`docker exec -i` over Spec 021/026's runner-host seam)**: Squeal spawns its runner-host process inside a long-lived container over `docker exec -i` stdio (instead of SSH), keeping warm runners and reusing `src/core/runner-host/remote/` (with bind-mounted worktree instead of delta file sync, or comparing both).
     - Check concretely what (C) requires inside the container: Squeal's runner-host bundle needs **Node 22+** (verify exact Node requirement in `src/core/runner-host/`), whereas `saas-boilerplate`'s `backend` and `workers` Dockerfiles ship **Node 20** (and pure Python/Go/Rust images ship no Node at all!). Can Squeal bind-mount a static/host Node binary into the container (check glibc/musl compatibility on bookworm vs alpine), or is (C) only viable for Node 22+ images unless a helper runtime is mounted?
     - Check how (C) handles deadline cancellation and orphan child processes inside a long-lived container (remember `007-58` Q2: killing `docker exec` leaves the child running inside the container unless the in-container runner-host itself owns a process group and kills it on stdin EOF / RPC cancel!). Verify by experiment whether a runner-host inside `docker exec -i` cleanly reaps its test process group when aborted or when `docker exec` disconnects.
   - Compare (A), (B), and (C) across: latency (cold, 1-file, 5-file), runner generality (pytest only vs Vitest/Jest/node:test/lint), image requirements (Node 22+ vs none), file ownership, cancellation/orphan cleanup, worktree concurrency, and implementation complexity in Squeal.
3. **Parallel batch and multi-worktree isolation (`saas-boilerplate` concrete hazards):**
   - Test running 2 to 4 concurrent pytest batches against one probe Postgres for both `backend` (with `setup.cfg`'s `--reuse-db` and `conftest.py`'s cleanup hooks) and `workers` (`create_all`/`drop_all` in `conftest.py`). Prove whether they collide today and verify the cleanest isolation mechanism (`TOX_PARALLEL_ENV` / `SQUEAL_SLOT` -> `test_backend_<slot>`, per-slot DB for workers, or `pytest-django` template DB).
   - Examine `saas-boilerplate`'s compose files (`docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.ci.yml`) for multi-worktree collisions: missing source mount in base compose, fixed host ports, `container_name: mcp-server`, external Postgres volume, and `localstack`. What minimal policy contract or compose convention lets two worktrees of `saas-boilerplate` run Squeal concurrently without colliding with each other or other projects on the host?
4. **Environment keying, provenance, rebuild detection, and anti-stale-pass checks:**
   - Extend `007-58` Q4 against Squeal's current keyer (`src/core/keys/`, `src/runners/pytest/environment/`, Spec 026 `environmentMode: "remote-key"`):
     - Exact inputs to hash: target image ID, effective service config (`docker compose config --hash` or inspected container config), dependency image IDs, compose/env files, and container platform/arch.
     - How Squeal detects and refuses a container whose worktree bind mount is missing, stale, or points to another worktree (preventing baked-in `COPY . /app` code from producing a false pass!). Verify a fast, cheap mount-identity check (e.g. sentinel file or `docker compose config` mount resolution + `realpath`).
     - Does `docker compose run --rm --no-deps` build a missing image by default (`007-58` open question 2)? Verify by experiment and check `--no-build` / `--pull never` flags in the installed Compose version.
     - How should Squeal notice an image rebuild (`docker image inspect` before a run vs `docker events` subscription)? Measure cost and reliability.
     - Can results produced in a container on a developer machine share store keys with CI runs (Spec 018) or other worktrees using the same image ID?
5. **Safety, consent, and lifecycle boundaries (Vision principle 8):**
   - Check Docker socket permissions, root-owned file prevention (`--user`, `HOME=/tmp`, `PYTHONPYCACHEPREFIX`), preventing Docker from auto-creating root-owned host directories for missing `-v` paths, reaping labelled containers on daemon crash/SIGKILL, and what `squeal setup` must ask/declare before enabling container execution.
6. **Recommendation and open questions for the human:**
   - Recommend (A), (B), (C), or a staged combination (for example: A + slot var immediately for `saas-boilerplate` + B or C as the general Docker mode), with exact measured evidence, Squeal code seams (`src/core/policy/`, `src/core/runner-host/`, `src/runners/pytest/`, `src/core/keys/`), and concrete open questions for the human to decide before writing `spec.md`.
