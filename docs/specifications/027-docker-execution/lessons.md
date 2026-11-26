# 027 Docker execution: lessons (row 027-07)

Row `027-07`, Wave 4, 2026-11-26. This file has the end-to-end proof, the live dogfooding of Spec 027 on a throwaway copy of `saas-boilerplate`, and the answer to Open Question 2. Every number below was measured in this session. Times are wall-clock times on Linux x64, 16 CPUs, Docker Engine 28.5.1 (rootful), Compose v5.6.1, one-minute load 4 to 6 from other agents' daemons and tests.

## Setup

- **Reference repository.** `~/projects/saas-boilerplate` at `caa46d26`, read only. Its `git status --short` was recorded before the work and compared after it (see "Safety and cleanup"). All work ran on a `git archive HEAD` copy under `$TMPDIR/dogfood/sb`, made its own git repository with local commits (the copy, then `squeal.config.json` and its edits).
- **Squeal.** The Claude Code plugin's `dist/` built from this worktree's `src` with the N1 and N2 fixes into `$TMPDIR/dogfood/plugin/dist` through `src/harness/build.ts`, never into `plugins/claude-code/dist`. Version string `0.1.644`. The daemon ran with `HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR` and `XDG_STATE_HOME` under `$TMPDIR/dogfood`, so the consent file `containers.json` was a scratch file and the real `~/.config/squeal` was never read or written.
- **Images (built by hand in the scratch copy, never by Squeal).** The repository's Dockerfiles install Node 20 (NodeSource `setup_20.x`), which Squeal refuses (Node 22.19+ is required). Two throwaway overlay Dockerfiles (`$TMPDIR/dogfood/images/`) repeat the `/pkgs` stage of `packages/backend/Dockerfile` and `packages/workers/Dockerfile` with NodeSource `setup_22.x`, without `chamber`, `awscli`, the static stage or the JS workspace install:

  | Image | Build | Size | Node | Python | pytest |
  | --- | --- | --- | --- | --- | --- |
  | `squeal-dogfood-backend:local` | 75 s (pulled base `python:3.11-slim-bookworm`) | 1.16 GB | 22.23.5 | 3.11.18 | 8.4.2 |
  | `squeal-dogfood-workers:local` | 37 s | 960 MB | 22.23.5 | 3.11 | from `uv.lock` |
  | `squeal-dogfood-backend:rebuild` | 43 s, `--no-cache` | 1.16 GB | 22.23.5 | 3.11.18 | 8.4.2 |

  The backend image keeps the repository's build-stage editable: `sb_backend-1.0.0.dist-info/direct_url.json` is `{"url":"file:///pkgs","dir_info":{"editable":true}}`, and `/pkgs` holds only `pyproject.toml`, `uv.lock` and `.venv`.
- **Dependencies.** A throwaway Compose project `squeal-dogfood-3904719` (file `$TMPDIR/dogfood/deps.compose.yml`): Postgres 16.1, Redis 7.2.4 and stripe-mock v0.170.0 from images already on the host, later three more Redis services `redis-1` to `redis-3`. No host ports, tmpfs data, label `org.squeal.dogfood=027-07`. `docker compose up -d --wait --pull never` took 1.7 s.
- **Policy (scratch copy, `squeal.config.json`).** Targets `backend` and `workers`, `network: "{composeProject}_default"`, `keyMode: "build-content"`, `dockerfileInputs` the package's `Dockerfile`, `uv.lock` and `pyproject.toml`. Project `backend`: the 8 files of research `027-01`'s sample (71 tests), `args: ["-o", "env_override_existing_values=0"]`, `batchSize: 2`, `slots: { toxParallelEnv: true, max: 3 }`, `DATABASE_URL` to the `db` service and `REDIS_CONNECTION` templated per slot. Project `workers`: `content/tests/test_sync.py` (2 tests), `DB_CONNECTION` as JSON with `"dbname":"workers_test_{worktreeSlot}"`, `slots: { max: 3 }`. Consent: `{"allow": {"<copy root>": {"enabled": true, "targets": ["backend", "workers"], "composeProject": "squeal-dogfood-3904719"}}}`.

## Measured run

| Step | Command | Result | Wall |
| --- | --- | --- | --- |
| Daemon start, consented targets | `squeal daemon` | both managed containers started, Node 22.23.5 admitted, `dev:inode` proof passed: `Containers: container backend (ready, build-content); container workers (ready, build-content)` | about 20 s, after F1 |
| First full run | `squeal run --all --wait` | 9 of 9 files `unknown`: no Python environment found (F2) | 1.4 s |
| With `python: "/pkgs/.venv"` | `squeal run --all --wait` | checkpoint completed, 9 files: 68 tests passed, 5 failed on the Redis URL (F3) | 71.8 s |
| Per-slot Redis hosts | automatic run after the policy reload | 73 passed (71 backend, 2 workers), 0 failed, all 9 files current | about 2 min, with the reload race (F5) |
| Edit `packages/backend/common/emails.py` | `squeal status --wait 300000 <path>` | 8 backend files selected and run again, all pass; the workers file stays current | 34.7 s |
| Edit one backend test file | same | 1 file selected and run, the other 8 stay current | 7.3 s |
| Edit `packages/workers/content/services.py` | same | 1 workers file run, the 8 backend files stay current | 1.3 s |
| Backend target to the `--no-cache` rebuild (new image ID `9828aa51936b`, was `8459eb97bc60`), `build-content` | policy edit | container replaced on the new image, no file run again: each backend check keeps its 3 results, all 9 files current | 11 s to ready |
| Same target to `keyMode: "image-id"` | policy edit | all 8 backend files re-keyed and run again (4 results each), all pass | 31.7 s |
| `squeal ps` | | a `Squeal containers` section lists both managed containers with target and daemon PID | |
| `squeal stop` | | daemon stopped, 0 containers labelled `org.squeal.managed=true` left | 0.53 s |

Parallel slots against shared services: Postgres held `test_backend_<wt>_1`, `_2` and `_3` (made by pytest-django from `TOX_PARALLEL_ENV`) and `workers_test_<wt>_1` to `_3`, and the three per-slot Redis instances held 2, 1 and 2 keys while the shared `redis` held 0. No run had a database or rate-limit collision. `<wt>` is the 8-character worktree token, the same inside the container because the worktree is mounted at its own path.

Files in the worktree after every run and after stop: 0 paths not owned by the host user, 0 `__pycache__` directories and 0 `.pytest_cache` directories under `packages/backend` and `packages/workers` (`PYTHONPYCACHEPREFIX` and the mounted cache work). `git status --short` showed only the three edits above.

N2 live: the 5 Redis failures of the second run read `recorded just now in container backend in this worktree at revision 1` in `squeal status`, with unchanged check names.

## Findings

1. **F1. The install gate holds Python-only container projects in a JS monorepo.** `saas-boilerplate`'s root `package.json` declares dependencies. Until an installed lockfile exists at the root, the daemon runs no test of any runner (spec 001 D5, `src/core/scheduler/install.ts`): "no dependencies are installed in this worktree". The pytest projects in containers do not need the JS install. The dogfood placed pnpm's marker (`node_modules/.pnpm/lock.yaml`, a copy of `pnpm-lock.yaml`) in the scratch copy instead of a full `pnpm install`. Candidate follow-up: scope the gate to the runners that read `node_modules`, or say in the note which runners it holds.
2. **F2. In-container discovery does not find `/pkgs/.venv` by itself.** D5.3 says the in-container host "discovers the container's own Python/Node environment (`/pkgs/.venv`, etc.) natively". It does not: pytest discovery (spec 007 D2) looks at `<cwd>/.venv` and `.pdm-python` only, so every file stayed `unknown` with "no Python environment (looked at packages/backend/.venv, ...)". Setting the project's `python: "/pkgs/.venv"` fixed it, and the D3 refinement then admitted the `/pkgs` editable with no note. Candidate follow-up: say this in D5.3 and in `squeal setup`'s container wording, or default `python` from the image's `VIRTUAL_ENV` or `PYTHONPATH`.
3. **F3. A Redis database number in `REDIS_CONNECTION` breaks this app.** D2's and D4's example `"REDIS_CONNECTION": "redis://redis:6379/{slot}"` gives `redis://redis:6379/2`. The backend's `CELERY_BROKER_URL` is `REDIS_CONNECTION + "/0"`, so Celery got `.../2/0` and 5 tests failed ("Database is int between 0 and limit - 1, not 2/0"). One Redis service per slot (`"redis://redis-{slot}:6379"`, three extra `redis` services in the developer's stack) passed all 73 tests. The spec example should use per-slot hosts or name the URL shape the app expects.
4. **F4. CI sharing for pytest cannot use `squeal ci record` today.** `squeal ci record` writes parts for Vitest and node:test only ("other runners only run"). So D7.2's "CI runs `squeal ci record` / `squeal ci export` inside the built container" does not apply to `saas-boilerplate`'s pytest suites, and no CI export or import round trip was possible. What D7.2 relies on did hold locally: two separate builds of one Dockerfile and lockfile (different image IDs) gave the same `build-content` keys, so nothing ran again, while `image-id` ran everything again. The automated `build-content` key tests (`test/runner-host/container/key.test.ts`) cover the descriptor. Candidate follow-up: pytest parts in `squeal ci record`.
5. **F5. A policy reload that replaces a container races with status.** After the `REDIS_CONNECTION` edit the reload replaced the backend container. For about 5 s the target read `docker-unreachable` ("the container's node did not answer: ... is not running"), and in that window `squeal status --wait 600000` returned "Returned on quiet ... all 1 test file current" while the 8 backend files were not listed at all. Five seconds later they were listed and running, and they passed. Seen once; worth a row to check that a replaced container's project keeps its files listed (as pending) through the replacement.
6. **F6. `squeal ps` names in-container runner hosts `local`.** The two hosts in the containers read `host pytest ... local`. The `Squeal containers` section lists the containers themselves correctly. A host line could name its container target.
7. **F7. Workers databases are not made per slot.** `packages/workers/setup.py create_db` hardcodes the database name, so the three `workers_test_<wt>_<slot>` databases were made by hand with `psql` before the first run. A project with per-slot databases needs its own setup step; Squeal cannot make them.

## Open Question 2: Compose project and network binding

**Answer: user-local `composeProject` (or `networkOverride`) in `~/.config/squeal/containers.json` is sufficient, and reading `COMPOSE_PROJECT_NAME` from the worktree's `.env` would not help `saas-boilerplate`.** Evidence:

- No committed file of `saas-boilerplate` sets `COMPOSE_PROJECT_NAME` or a top-level `name:` (searched `docker-compose*.yml` and `.env*`). The checkout has no `.env` at all until a developer copies `.env.shared`, which sets `PROJECT_NAME=saas` for image names and `COMPOSE_FILE`, not the Compose project.
- Compose therefore names the project after the checkout's directory: `docker compose config` in the scratch copy printed `name: sb`; in the reference checkout it is `saas-boilerplate`. Each worktree directory gets its own default network, which no committed file can name.
- The dogfood bound the targets with the committed `"network": "{composeProject}_default"` and the user-local `"composeProject": "squeal-dogfood-3904719"`. Both containers joined that network and reached `db`, `redis`, `redis-1` to `redis-3` and `stripemock` by name: all 73 tests passed, the 3 Stripe webhook tests included.

A later convenience could offer the running Compose projects (`docker compose ls`) in `squeal setup`, but no `.env` parsing is needed.

## End-to-end suite (`test/e2e/spec-027-docker.test.ts`)

Real daemons from the plugin bundle built from this worktree (`spec-026-build.ts` plus the Jest runtime, which `bundleRootFor` requires before the daemon mounts a bundle):

- Stage 1, no Docker: 4 pytest files in a uv-synced copy of `test/fixtures/pytest/small`, `batchSize: 1`, `slots.max: 2`. Each file saw `SQUEAL_SLOT` 1 or 2, `SQUEAL_WORKTREE_SLOT` `<wt>_<slot>`, `TOX_PARALLEL_ENV` equal to it, `{slot}`, `{slot0}` and `{worktreeSlot}` expanded, JSON braces kept and `{unknown}` left literal; no two batches overlapped in one slot, and two did overlap. A second daemon ran none of the 4 files again: no slot moves a key. An empty build-stage editable (outside any checkout, its `.pth` in its `RECORD`) is admitted; the same editable with a module is refused with the `editable, outside this worktree` note.
- Stage 2, no Docker: a container project without consent, with a logging `docker` first on `PATH`, makes zero `docker` calls, shows `Containers: container node (unconsented, build-content)` and the `squeal setup` note; when the project leaves its container, the line is cleared (review 0.1.644 N1).
- Stage 2 on the host's Docker, only with a local Node 22.19+ image (`SQUEAL_TEST_NODE_IMAGE`, else an image whose `NODE_VERSION` says so; never pulled): the test runs in the managed container on the live mount, a Node-less image is refused as `node-too-old` with the 22.19 note, a daemon killed with SIGKILL leaves its container and the next daemon reaps it, `squeal ps` lists it, `squeal stop` leaves zero containers and the worktree has zero files the host user does not own. This host has no such image after cleanup, so this block skips here; it passed with `SQUEAL_TEST_NODE_IMAGE=squeal-dogfood-workers:local` before the image was removed.

Not covered end to end, and why: `build-content` against `image-id` key separation and CI export or import are in unit tests (`key.test.ts`) and in the dogfood above, because no image the suite may use is built twice, and `ci record` has no pytest parts (F4).

## Safety and cleanup

- `git -C ~/projects/saas-boilerplate status --short` was ` M .claude/settings.json` and `?? .ai/` before the work and the same after it; its stash list was empty both times. Nothing under it was written.
- Removed after the run: both managed containers (by `squeal stop`), the Compose project `squeal-dogfood-3904719` with its 6 containers and its network (`docker compose down`), the images `squeal-dogfood-backend:local`, `squeal-dogfood-backend:rebuild`, `squeal-dogfood-workers:local` and the base `python:3.11-slim-bookworm` this build pulled, and the scratch directory `$TMPDIR/dogfood`. After that, `docker ps -a` filtered by `label=com.docker.compose.project=squeal-dogfood-3904719`, by `label=org.squeal.managed=true` and by `label=org.squeal.dogfood=027-07` listed nothing, and no network or volume carried those labels. BuildKit cache entries stay, as in research `027-01`, because `docker builder prune` cannot filter by label.
