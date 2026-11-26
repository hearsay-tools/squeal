# Research: docker-execution (027-01)

Topic `docker-execution` of `research/README.md`. Run on 2026-11-26 on Linux x64, 16 CPUs, one-minute load 1.1 to 5.6 (printed per measurement in `probes/docker-execution/out/`). Docker Engine 28.5.1 (rootful), Compose v5.6.1. Real case: `apptension/saas-boilerplate` at `caa46d26`, read only; all runs on a `git archive` copy under `$TMPDIR`. Host side: uv 0.12.2, CPython 3.11.15, Node 26.13.0. Images built from the repo's own Dockerfiles: CPython 3.11.18, Node 20.20.2, uv 0.9.29; backend pytest 8.4.2, pytest-django 4.11.1, pytest-dotenv 0.5.2; workers pytest 7.4.4. Squeal: this worktree at `ade349335`, bundle `plugins/claude-code/dist` 0.1.641. Builds on `007-pytest-runner/research/tests-in-docker.md` (007-58) and does not repeat it.

Two corrections to the brief: `packages/workers` has **one** test file (`content/tests/test_sync.py`, 2 tests), not 6; and `src/core/policy/` does not exist (policy lives in `src/core/types/policy.ts` and `src/core/daemon/policy-*.ts`). Both read in source code.

## Questions answered

| # | Short answer | Tag |
|---|---|---|
| 1 | Host runs work: backend sample 68 of 71 pass, workers 2 of 2, once `-o env_override_existing_values=0` lets `DATABASE_URL`, `REDIS_CONNECTION` and `DB_CONNECTION` win. The 3 failures are Stripe tests that hardcode `http://stripemock:12111`. No test in the sample needs `chamber`, Node or `psql`. In the image, all 71 pass and Squeal's runtime writes clean events, user-owned, with `/app` paths (none with a same-path mount). Per batch, 1 file / 5 files, medians: host 6.0 / 9.9 s; `docker exec` 5.8 / 9.7 s; `docker run --rm` 11.3 / 15.3 s, 6.6 / 10.0 s with a persistent bytecode directory; `compose run --rm` 11.3 / 14.5 s. | verified by experiment |
| 2 | (A) is fastest to ship and runner-general but needs reachable services. (B) costs 0.5 s per batch with persistent bytecode, 5 s without, and leaves containers on a kill. (C) runs at host speed (5.8 / 9.0 s per batch after a 1.65 s start), runs pytest and node:test, and reaps its test process group on cancel, stdin end, client kill and daemon kill. (C) needs Node 22.19 or later in the container: the images' Node 20 fails on `node:sqlite`; a mounted host Node works only on glibc 2.28+ images that have `libatomic.so.1`. | verified by experiment; Node floor read in source code |
| 3 | Shared names collide: a cold shared `test_backend` fails 2 of 3 concurrent batches; a shared Redis fails 1 to 2 rate-limit tests per batch and later signup tests; a shared `workers_test` fails 6 of 9 batches. Per-slot names fixed all three: `TOX_PARALLEL_ENV`, a Redis database number, a workers database per slot. The compose files collide on fixed ports, `container_name: mcp-server`, a shared external volume and a shared image tag. | verified by experiment; compose by `config` |
| 4 | `compose run` builds a missing image even with `--pull never`; `docker run --pull never` refuses. Without the source mount a broken test passes from baked code; dev:inode of the root proves the mount at no extra process. `image inspect` costs 16 ms. A no-cache rebuild gives a new image ID with identical packages, so image-ID keys never match across machines; content keys could. | verified by experiment |
| 5 | The agent is now in group `docker` (root on the host). `--user` and `PYTHONPYCACHEPREFIX` keep the worktree user-owned; `--mount` refuses a missing source where `-v` creates a root-owned directory; a killed `docker run` client leaves its container until removed by label. | verified by experiment |
| 6 | Stage it: (A) with a slot variable and per-slot Redis for saas-boilerplate now; (C) as the general container mode later; not (B). | inferred from 1 to 5 |

## Findings

### Q1. Host pytest against container pytest

**Host (a).** `uv sync --frozen` made each `.venv` in 4.3 s and 1.3 s (warm uv cache). pytest-dotenv 0.5.2 loads `.test.env` in `pytest_load_initial_conftests` with `override=` the ini value (read in source code, `pytest_dotenv/plugin.py`), so `DB_CONNECTION` (host `db`) and `REDIS_CONNECTION` (`redis://redis:6379`) beat the environment. `config/settings.py` reads `DATABASE_URL` first and `.test.env` does not set it, so `DATABASE_URL` alone moves Postgres; Redis needs the override. The clean override is one pytest argument, `-o env_override_existing_values=0`, which Squeal's project `args` can carry (verified by experiment). Without it, 10 schema tests failed on `redis:6379` name resolution.

Sample: 8 backend files, 71 tests (DB models, GraphQL schema, email task, S3 via moto, Stripe webhooks, backup and tenant tasks). Host result: 68 passed, 3 failed (`out/01`). The 3 are `test_webhooks.py` tests whose fixture sets `stripe.api_base = "http://stripemock:12111"` (read in source code, `apps/finances/tests/fixtures.py:118`); `stripemock` resolves only on the Compose network. `send_email` runs `node` with `cwd="/app/scripts/runtime"` (read in source code, `common/emails.py`), but its test mocks `subprocess.run`, so it passed on the host. A daemon that inherits `HTTP_PROXY` sends `stripemock` requests to the proxy (`bad gateway`), a second host-only hazard. Workers: `setup.py create_db` loads `.env.test` with `override=True` and cannot be pointed at the host (`could not translate host name "db"`); with the database made by hand, 2 of 2 passed in 0.98 to 1.05 s.

**Container (b).** Backend image from `packages/backend/Dockerfile`: 60 s build, 1.26 GB. Workers image: 76 s, 1.98 GB (full repo context, pnpm install). With the copy mounted at `/app`, the runtime mounted `:ro` and `PYTHONPATH=/pkgs/.venv/lib/python3.11/site-packages:/squeal`, all 71 backend tests passed and workers 2 of 2 (`out/01`). The events file had 1,571 lines, node ids and `location.path` relative, every absolute path under `/app`, owned by the agent's uid with `--user`; no file appeared in the worktree with `PYTHONPYCACHEPREFIX=/tmp/pycache`. Mounting the worktree at its **own absolute path** inside the container made all 1,611 absolute paths host paths: no mapping needed.

Batch wall times, five runs each, load 3.6 to 5.6 (`out/02`, `out/02b`):

| Way | 1 file (2 tests), median (min to max) ms | 5 files (18 tests), median ms | Overhead of `true` |
|---|---|---|---|
| host `.venv` | 6033 (5942 to 9851) | 9907 | none |
| `docker exec -i`, long-lived container | 5827 (5689 to 10673) | 9699 | 52 to 63 ms |
| `docker run --rm --init` | 11319 (11219 to 11662) | 15299 | 336 to 361 ms |
| same, bytecode directory mounted | 6630 (6268 to 11169) | 9990 | |
| `compose run --rm -T --no-deps` | 11265 (10576 to 12123) | 14503 | 411 to 436 ms |

Django start-up dominates (about 4.5 s of the 6 s). The fresh-container penalty is bytecode: the image holds 15,287 `.py` and 0 `.pyc` files under `/pkgs/.venv`, because `uv sync` does not compile by default; a persistent prefix directory removes it. Workers: host 1.0 s, `docker run` 1.5 s warm, 3.4 s cold.

### Q2. Three architectures

**(C) verified end to end.** `drive-host.mjs` started `squeal.mjs runner-host /app --runner pytest` inside a long-lived container over `docker exec -i`. On the repo's image it ran nothing: "the environment /pkgs/.venv installs "sb_backend" from /pkgs editable, outside this worktree" (both Dockerfiles `uv sync` the project itself into `/pkgs`; `direct_url.json` is `file:///pkgs`, editable). With that dist-info removed in a probe image, `start` took 1.65 s and runs completed: 1 file 5.6 to 5.9 s, 5 files 9.0 to 9.2 s after the first (`out/07`). A node:test project ran the same way in 95 ms (`out/08`).

Node: `package.json` says `"node": ">=22.19"` (read in source code). On the images' Node 20.20.2 the host exits `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. The host's Node 26 binary mounted read-only ran the host in the backend image (glibc 2.36), failed in `python:3.11-slim-bookworm` (`libatomic.so.1: cannot open shared object file`) and in Alpine (`exec ... no such file or directory`, musl). The binary needs `GLIBC_2.28` at most (`objdump -T`). So (C) runs on any image only with a self-contained Node that Squeal brings, or on images with Node 22.19+.

Cleanup, test that starts `sleep 300` then sleeps 120 s (`out/03*`):

| Ending | Left in the container 4 s later |
|---|---|
| runner host: `cancel` request | nothing |
| runner host: stdin closed | nothing |
| runner host: `docker exec` client SIGKILL | nothing |
| runner host: daemon stand-in SIGKILL, client alive | nothing |
| control: plain `docker exec -i python -m pytest`, client SIGKILL | pytest and `sleep 300` |

Docker closes the exec's stdin when the client dies (inferred from the result); the host's input end runs `stopAll`, which SIGTERMs then SIGKILLs the batch's process group (read in source code, `host.ts`, `run/run.ts`). The plain exec has nobody to do that.

Comparison:

| | (A) host + services | (B) container per batch | (C) runner host in container |
|---|---|---|---|
| 1 / 5 files per batch | 6.0 / 9.9 s | 6.6 / 10.0 s with bytecode dir; 11.3 / 15.3 s without | 5.8 / 9.0 s, plus 1.65 s once |
| Runners | all, as today | pytest; a per-batch Vitest would lose its warm instance (inferred) | vitest, node-test, pytest (`HOST_RUNNERS`) |
| Image needs | none; host must match container libraries | none beyond the project's | Node 22.19+, or Squeal's own Node with glibc 2.28 and libatomic |
| Ownership | user | `--user`, `HOME`, bytecode prefix | same, set once on the container |
| Cancel / orphans | as today | `--init` plus `rm -f` by label (007-58) | host reaps its group (verified) |
| Worktree concurrency | per-slot names (Q3) | same, plus per-batch containers | one container per worktree |
| Squeal work | slot variable, env template | new run path, mount and image checks | a container launcher for the host seam, mount and image checks, keys from inside |

(C) is closer to the local host than to the remote one: with a bind mount it needs no bundle copy, tree sync or path map, only a launch prefix in front of `spawnRunnerHost` (`channel.ts`). The remote seam compares environments under `match-local`: "installed dependencies and allow-listed variables still equal this side's" (read in source code, `remote/environment.ts`); a container's `/pkgs/.venv` never equals the host's, so remote rules would refuse every container result (inferred).

### Q3. Parallel batches and worktrees

On one probe Postgres and Redis, host runs (`out/04`):

| Case | Result |
|---|---|
| shared `test_backend`, cold, 3 batches | 2 of 3 errored: `UniqueViolation ... pg_database_datname_index`, `already exists`; 1 passed in 22.5 s |
| shared `test_backend`, warm, 4 batches x 3 rounds | 12 of 12 passed (no transactional tests in the repo) |
| `TOX_PARALLEL_ENV=s1..s4`, cold | 3 passed in 25 to 26 s; one had 5 signup failures, first `Rate limit exceeded.` |
| same slots, warm | 4 of 4 passed, 8.5 to 13.3 s |
| rate-limit file, 3 batches, one Redis db, 2 rounds | 4 of 6 batches had 1 to 2 failures |
| same, Redis db 1, 2, 3 per slot | 6 of 6 passed |
| workers, one `workers_test`, 3 batches x 3 rounds | 6 of 9 batches failed: `UniqueViolation ... pg_class_relname_nsp_index` |
| workers, a database per slot | 9 of 9 passed |

`common/ratelimiting` tests call `cache.clear()` on Redis, and signup counts requests in Redis, so batches and even consecutive rounds share counters. pytest-django 4.11.1 suffixes the test database only from xdist's `workerid` or `TOX_PARALLEL_ENV` (read in source code, `pytest_django/fixtures.py:69-85`). `pytest_django_db_setup.py` is imported by nothing (read in source code). A slot database costs about 17 s once, then `--reuse-db` keeps it.

Compose (`docker compose config`, no containers started): no `name:`, so the project is the directory name; fixed host ports `5432`, `6379`, `5001`, `4000`, `12111`, `12112`, and with the local file `1080`, `1025`, `3005`, `4566`, `5555`; `container_name: mcp-server`; volume `${PROJECT_NAME}-web-backend-db-data` external; with `PROJECT_NAME` unset every build tags `/backend`, so worktrees overwrite one tag. Base `backend` and `workers` have no source mount. The repo has no worktree script or overlay. On this host, port 5432 is already held by another project's Postgres, so the base file cannot start here at all.

Minimal contract that let the probes run beside each other and the host's other containers: services in a Compose project named per worktree, or one shared project; published ports `127.0.0.1::<port>` read back with `docker compose port`; no `container_name`; data on tmpfs or a per-project volume; tests reach them by `DATABASE_URL` and `REDIS_CONNECTION` (A) or by service name on the project network (C). Within one daemon, per-slot names; across worktrees that share services, the slot value must also be unique per worktree (inferred: two daemons would both use `s1`).

### Q4. Identity, provenance and stale passes

Verified by experiment (`out/05`, `run-5`):

- **Builds.** `docker compose run --rm -T --no-deps --pull never` on a service with `build:` and no image built it; so did `pull_policy: never`. `run` has no `--no-build` (`unknown flag`). `docker run --pull never` refused with `No such image`, and so did `compose run` on a service without `build:`. Squeal must check `image inspect` first or not call `compose run`.
- **Stale code.** A test edited to fail: with the mount, `1 failed, 1 passed`; without it, as the base compose runs `backend`, `2 passed` from `COPY . /app`.
- **Mount proof.** `stat` of the root: host `66306:215291`; correct mount `66306:215291`; another directory mounted `66306:1618762511`; baked `56:2901237`. The plugin's `start` event could carry `os.stat(root)` and Squeal compare it, at no extra process (inferred). Other costs, medians of 10: `image inspect` 16 ms, `docker inspect` mounts and image 17 ms, `compose config --hash` 65 ms, `compose config --format json` 67 ms.
- **Rebuilds.** `docker events --filter type=image` printed `tag <new id> <name>` and `create` for a rebuild of a tag; a running container kept its old image (007-58). Polling `image inspect` per batch costs 16 ms and needs no subscription that a daemon restart drops; events tell sooner but must be backed by a poll (inferred).
- **Sharing.** A `--no-cache` rebuild (58 s) of the same Dockerfile and lockfile gave ID `ac46edbe5466` against `e10508cb4a59`, with the same 238 Python distributions (one hash), the same `dpkg-query -W` hash and the same Node. Image-ID keys therefore never match another build, CI's included (CI runs `pnpm nx run backend:test`, which builds and `compose run`s; read in source code, `.github/workflows/backend.yml`). Content keys (interpreter, distributions, system packages, Node) would match. (C) computes Squeal's pytest environment from inside the container, which is already content-based (inferred from `environment/hash.ts`).

### Q5. Safety, consent, lifecycle

Verified by experiment (`out/06`): the socket is `srw-rw---- root:docker` and the agent is now in group `docker`, so a daemon gets root-equivalent access without asking (007-58 read the docs on this). As default root, a container wrote a root-owned `.pyc` into the mount; with `--user 1001:1001` and `HOME=/tmp`, agent-owned. `-v <missing>:/x` succeeded and created a root-owned directory; `--mount type=bind,source=<missing>` failed with `bind source path does not exist`. A SIGKILLed `docker run --rm --init` client left its container running; `docker rm -f` by `org.squeal.run` label removed it. The repo's local compose set includes `localstack` with `privileged: true` and the Docker socket (read in source code); it never started here.

Setup must state that container mode gives Squeal root-equivalent access, and must name: the image or service, its network, the mount (same path), the run user, whether Squeal may start anything (default: nothing), and the Node Squeal brings for (C) (inferred).

## Recommendation for Squeal

1. **Now, (A) for saas-boilerplate.** No container code. Policy for `backend`: `env` with `DATABASE_URL` and `REDIS_CONNECTION` pointing at services on `127.0.0.1` ports, and `args: ["-o", "env_override_existing_values=0"]`. Build row 007-60 with two parts: a slot value per running pytest process, unique across worktrees, exported as `TOX_PARALLEL_ENV` (zero project change for Django) and as `SQUEAL_SLOT`; and a way to put the slot into the project's own variables (`redis://...:<port>/{slot}`, the workers' `DB_CONNECTION` JSON `dbname`). Known gaps to report as notes, not fix: the 3 `stripemock` tests, workers' `create_db`. Seams: `src/runners/pytest/run/run.ts` (env per batch), `src/core/types/policy.ts` (env templating), `src/core/daemon/policy-pytest.ts`.
2. **Later, (C) as the general container mode.** Launch `squeal runner-host` inside one long-lived container per worktree over `docker exec -i`, worktree and Squeal state mounted at their own paths, `--user`, a persistent bytecode prefix. Bring a Node that runs on glibc images without `libatomic`, or refuse with one note. Key results by the environment the host computes inside (content), never by tag. Check before each run: the container's image ID (16 ms), and the root's dev:inode from the plugin. Relax D2's editable refusal for an editable whose directory has no package code (the image's `/pkgs`). Seams: `src/core/runner-host/channel.ts` (`spawnRunnerHost` launch prefix), `src/core/runner-host/remote/environment.ts` (a container rule beside `match-local` and `remote-key`), `src/runners/pytest/environment/states.ts`, `src/core/keys/`.
3. **Not (B).** It matches (C) only with a bytecode directory, cannot keep a Vitest instance warm, leaves containers on a kill, and `compose run` may build.
4. **Never** `build`, `pull`, `up`, `down`, or touch unlabelled resources; use `--mount`, never `-v`.

## Open questions for the human

1. Is a host run acceptable for saas-boilerplate when 3 Stripe tests fail on the host only, or must Squeal reproduce the container network (C) before it reports them?
2. Who starts the services: the developer per worktree (Squeal reads ports), or may Squeal start a Compose project it labels? Today Squeal starts nothing.
3. The slot variable: export `TOX_PARALLEL_ENV` directly, or only `SQUEAL_SLOT` plus templating? Must it be unique across worktrees, or do worktrees get their own services?
4. For (C): may Squeal mount its own Node into a project's container, or must the image ship Node 22.19+?
5. Key container results by image ID (exact, never shared with CI or a teammate) or by content (shareable, misses a changed system file that no package records)?
6. Not determined, because not run: rootless Docker, Podman and Docker Desktop; Vitest and Jest inside (C); the full 3,000-test backend suite.

## Sources

- Probes and captured output: `probes/docker-execution/` (README, `run-1` to `run-6`, `drive-host.mjs`, `out/`).
- saas-boilerplate `caa46d26`, read only: `docker-compose{,.local,.ci}.yml`, `packages/backend/{Dockerfile,setup.cfg,.test.env,conftest.py,pytest_django_db_setup.py,config/settings.py,common/emails.py,apps/finances/tests/fixtures.py,common/ratelimiting/tests/test_ratelimiting.py,project.json,scripts/runtime/run_tests.sh}`, `packages/workers/{Dockerfile,conftest.py,setup.cfg,setup.py,.env.test,settings/base.py,dao/db/connection.py,project.json}`, `.github/workflows/backend.yml`. Installed `pytest_dotenv/plugin.py` 0.5.2 and `pytest_django/fixtures.py` 4.11.1 in the probe `.venv`.
- Squeal at `ade349335`: `package.json` (`engines`), `src/core/runner-host/{protocol.ts,host.ts,channel.ts,runners.ts}`, `src/core/runner-host/remote/{bundle.ts,connect.ts,ssh.ts,environment.ts,remote-key.ts,providers/command.ts}`, `src/runners/pytest/run/{command.ts,run.ts}`, `src/runners/pytest/environment/hash.ts`, `src/runners/pytest/runtime/squeal_pytest.py`, `src/core/types/policy.ts`, `src/core/types/keys.ts`.
- Docker CLI 28.5.1 and Compose v5.6.1 as installed: `docker compose run --help` (no `--no-build`), error texts quoted above.
- Prior research: `../../007-pytest-runner/research/tests-in-docker.md` (Docker docs on socket privileges, PID 1 signals, `-v` auto-create; prior art).
