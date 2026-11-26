# 027 Docker execution

## Problem

Projects such as `apptension/saas-boilerplate` run backend and worker test suites inside Docker containers against containerized Postgres, Redis, and mock services. Today Squeal cannot run these suites reliably for two reasons:

1. **Shared external state collides under Squeal's parallel batches.** Squeal runs pytest batches concurrently with `-n 0`. On `saas-boilerplate`, concurrent batches collide on Postgres (`test_backend` cold creation failed 2 of 3 batches; `workers_test` failed 6 of 9) and on Redis rate-limit counters (4 of 6 batches failed and broke subsequent signup tests). Squeal provides no per-batch slot identifier or environment templating.
2. **No container execution mode exists.** Running `saas-boilerplate` on the host (`uv sync` + Compose Postgres/Redis) passes 68 of 71 sampled backend tests, but 3 Stripe webhook tests hardcode `http://stripemock:12111`, which resolves only on the Compose network. Other projects depend on container-only OS libraries, binaries, or Python/Node layouts (such as `/pkgs/.venv` with a build-stage editable install that Squeal's pytest D2 check currently refuses).

## Goals

1. **Per-batch slot isolation works for both host and container runs (D1, D2).** Concurrent batches receive a unique slot identifier (`SQUEAL_SLOT`, and optional `TOX_PARALLEL_ENV` for pytest) and can template it into per-project `env` values (for example `REDIS_CONNECTION` DB numbers and database names), eliminating parallel Postgres and Redis collisions on `saas-boilerplate`.
2. **Build-stage empty editables in container images do not block pytest (D3).** Squeal's pytest environment check still refuses any editable install pointing to real package source outside the worktree, while admitting build-stage metadata editables whose directory holds no package code (such as `saas-boilerplate`'s `/pkgs/.venv`).
3. **Container runner-host execution runs at host speed across runners (D4, D5).** Squeal runs its `runner-host` inside one long-lived, Squeal-labelled container per worktree over `docker exec -i`, with the worktree bind-mounted at its exact host path (zero path mapping) and Node 22.19+ inside the image. On `saas-boilerplate`, all 71 sampled backend tests and 2 worker tests pass at host speed (~5.8 s for 1 file, ~9.0 s for 5 files).
4. **Cancellation and daemon crashes leave zero orphan processes or containers (D5).** On cancel, stdin EOF, `docker exec` SIGKILL, or daemon SIGKILL, the in-container runner host reaps its entire test process group. Daemon exit and startup sweep remove Squeal-labelled managed containers.
5. **Stale passes from baked code or rebuilt images are impossible (D6, D7).** Squeal verifies the live bind mount via root `dev:inode` before admitting results, detects image rebuilds via `docker image inspect`, and keys results in a container key space using `build-content` keying by default (for CI sharing across separate `docker build` runs) with opt-in strict `image-id` keying.
6. **Host security boundaries hold (D4, Vision principle 8).** Container execution requires explicit user-local opt-in consent (never auto-enabled by a committed repo file), never runs `docker build`, `docker pull`, `docker compose up/down`, or `privileged: true`, always uses `--mount` (never `-v`), and runs as the host user (`--user <uid>:<gid>`) so zero root-owned files enter the worktree.

## Non-goals

- **Per-batch container spawning (`docker compose run --rm` / `docker run --rm` per batch).** Research `027-01` proved it adds ~5 s per batch on uncompiled `.pyc` images, cannot keep warm JS runners, leaks containers on kill, and `compose run` ignores `--pull never` when a `build:` image is missing.
- **Mounting a host Node binary into containers lacking Node 22.19+.** Decided 2026-11-26 (the human): no ABI exceptions; container images must ship Node 22.19+ (matching Squeal's `engines.node`).
- **Starting, building, pulling, or stopping project dependency stacks.** Squeal never runs `docker build`, `docker pull`, or `docker compose up/down`. The developer or worktree setup starts Postgres, Redis, and mock services; Squeal connects to their declared network or host ports.
- **Rootless Docker, Podman, and macOS Docker Desktop tuning in the first release.** First release targets Linux rootful Docker Engine (28.x+) and documents untested runtimes honestly; follow-up rows can add them once verified.
- **Replacing remote cloud execution (Spec 026).** Container mode targets local Docker containers with bind-mounted worktrees (zero file sync); Spec 026 continues to own remote SSH/cloud VMs.

## Design

Implementation is staged in two parts: **Stage 1 (D1 to D3)** ships slot isolation, env templating, and the pytest editable refinement (immediately unblocking host runs with Compose services and needed by Stage 2 as well); **Stage 2 (D4 to D7)** ships the general container runner-host over `docker exec -i`.

### D1. Per-batch slot allocation (closes row `007-60`)

Add a small slot allocator (`src/core/runner-host/slots.ts`, shared across runners, wired first in `src/runners/pytest/run/run.ts`):

1. **Slot acquisition.** Each concurrent batch process acquires the lowest free integer slot `1..concurrency` before spawn and releases it in `finally` after the process group exits.
2. **Worktree-unique prefix.** When two worktrees share one Postgres or Redis instance, integer slots `1..N` would collide across daemons. Derive a deterministic short worktree token `wt` (for example the first 8 hex characters of SHA-256 of the real worktree path, or a policy-configured `slotPrefix`) and form `worktreeSlot = "<wt>_<slot>"`.
3. **Exported variables.** For every batch process when `slots` is enabled (or always for pytest batches when `slots.enabled` is not `false`):
   - `SQUEAL_SLOT`: numeric string `"1"`, `"2"`, ... (useful for Redis DB indices `0..15`).
   - `SQUEAL_WORKTREE_SLOT`: `"<wt>_<slot>"` (useful for Postgres database suffixes shared across worktrees).
   - `TOX_PARALLEL_ENV`: exported automatically for pytest projects when `slots.toxParallelEnv` is `true` (default `false` so existing projects keep identical env unless configured; set `true` for `pytest-django` projects so `test_backend_<worktreeSlot>` works with zero project edits).
4. **Keying invariant.** Slot variables are runtime isolation parameters, never inputs to the check key (two batches running in slot 1 vs slot 2 test identical code and share keys). Slot variables are excluded from `env.allowlist` hashing if templated via `D2`.

### D2. Per-project `env` templating

Extend `PytestProject` (and `NodeTestProject` / `JestProject` policy env shapes in `src/core/types/policy.ts` and `src/core/daemon/policy-pytest.ts`):

1. **Template placeholders.** Values in `project.env` may contain `{slot}` (replaced with `SQUEAL_SLOT`), `{slot0}` (zero-based `slot - 1`), and `{worktreeSlot}` (replaced with `SQUEAL_WORKTREE_SLOT`). Example for `saas-boilerplate`:
   ```json
   {
     "pytest": [
       {
         "name": "backend",
         "cwd": "packages/backend",
         "args": ["-o", "env_override_existing_values=0"],
         "slots": { "toxParallelEnv": true },
         "env": {
           "DATABASE_URL": "postgres://backend:backend@127.0.0.1:5432/backend",
           "REDIS_CONNECTION": "redis://127.0.0.1:6379/{slot}"
         }
       }
     ]
   }
   ```
   And for `packages/workers`:
   ```json
   {
     "env": {
       "DB_CONNECTION": "{\"dbname\":\"workers_test_{worktreeSlot}\",\"username\":\"backend\",\"password\":\"backend\",\"host\":\"127.0.0.1\",\"port\":5432}"
     }
   }
   ```
2. **Deterministic hashing.** The environment hash (`src/runners/pytest/environment/hash.ts`) hashes the **unexpanded template string**, not the per-batch expanded value, so every slot computes the same key for the same configuration.
3. **Validation.** Unknown `{...}` placeholders are left literal (avoiding breakage of JSON strings such as `DB_CONNECTION`); only the three exact tokens `{slot}`, `{slot0}`, `{worktreeSlot}` expand. Policy validation checks `slots.toxParallelEnv` (boolean) and optional `slots.max` (positive integer cap, e.g. `15` for Redis databases `1..15`).
4. **Concurrency bound.** When `slots.max` is set, effective batch concurrency for that project is `min(concurrency, slots.max)` so a project with 15 Redis databases never allocates slot 16.

### D3. Pytest editable-install refinement for container build stages

In `src/runners/pytest/environment/states.ts` (`outsideEditables`):

1. **Current rule (Spec 007 D2):** Refuses any `*.dist-info/direct_url.json` with `dir_info.editable === true` whose `url` points outside the worktree root, preventing tests from importing another worktree's code.
2. **Observed container pattern (`027-01` Q2):** Both `saas-boilerplate` Dockerfiles run `COPY uv.lock pyproject.toml /pkgs/ && uv sync --frozen` in `/pkgs` (which creates an editable install of `sb_backend` pointing to `file:///pkgs`), then mount or copy the real code into `/app`. Because `/pkgs` contains only `pyproject.toml`, `uv.lock`, and `.venv` (no `.py` package files and no `.pth` pointing at source packages with `.py` files outside the worktree), importing project modules resolves from `cwd` (`/app`, the live worktree), never from `/pkgs`.
3. **Refined rule:** An outside editable `direct_url.json` is skipped (not treated as `editable-outside`) **only if** all three hold:
   - The directory exists and is not inside another git worktree of this repository;
   - Any `.pth` or editable finder file belonging to that distribution points only to directories containing zero `.py` source modules (excluding `.venv` / `__pypackages__`); and
   - The editable directory itself contains zero top-level `.py` modules or package directories (`*/__init__.py`) outside `.venv`.
4. **Fail-closed safety:** Any outside editable that actually resolves Python code outside the worktree (including another worktree checkout or an external editable library with `.py` files) continues to be refused with the exact existing `editable-outside` state and note.

### D4. Container execution configuration and user-local consent

Container execution is governed by two separate files so a cloned repository can never grant itself Docker access (Vision principle 8):

1. **Repository declaration (`squeal.config.json`, committed):**
   Optional `containers` map of named container execution targets, referenced by a runner project via `"container": "<target-name>"`:
   ```json
   {
     "containers": {
       "backend": {
         "image": "saas-boilerplate/backend",
         "network": "saas-boilerplate_default",
         "workdir": "/app",
         "keyMode": "build-content",
         "dockerfileInputs": ["packages/backend/Dockerfile", "packages/backend/uv.lock", "packages/backend/pyproject.toml"],
         "dependencyServices": ["db", "redis", "stripemock"]
       }
     },
     "pytest": [
       {
         "name": "backend",
         "cwd": "packages/backend",
         "container": "backend",
         "slots": { "toxParallelEnv": true, "max": 15 },
         "env": {
           "REDIS_CONNECTION": "redis://redis:6379/{slot}"
         }
       }
     ]
   }
   ```
   - `image`: local image tag/name to launch (checked with `docker image inspect`, never built or pulled).
   - `network`: Docker network name (or `"compose:<project>"` / `"none"`). May use `{composeProject}` resolved from the user-local binding.
   - `keyMode`: `"build-content"` (default, decided 2026-11-26) or `"image-id"` (opt-in strict local image pinning) (D7).
   - `dockerfileInputs`: repo-relative paths hashed into the environment key under `"build-content"` (and optional audit metadata under `"image-id"`).
   - `dependencyServices`: optional Compose service names whose running container image IDs are inspected and folded into the key when available.
   - `env`: extra non-secret environment variables passed into the container (supports D2 slot templates when set on the project).
2. **User-local consent (`~/.config/squeal/containers.json`, never committed):**
   Follows the exact trust pattern of Spec 026 `~/.config/squeal/remote.json`:
   ```json
   {
     "allow": {
       "<repo-canonical-root-or-origin>": {
         "enabled": true,
         "targets": ["backend", "workers"],
         "composeProject": "sb-dev",
         "networkOverride": "sb-dev_default"
       }
     }
   }
   ```
   - Without an explicit matching `enabled: true` entry in `~/.config/squeal/containers.json`, Squeal **never** executes any `docker` command for a container-configured project: its files stay `unknown` with one actionable note explaining that container mode needs local opt-in via `squeal setup` (which warns clearly that Docker socket access is root-equivalent on the host).
3. **Forbidden Docker operations (hard invariants):**
   - Squeal **never** calls `docker build`, `docker pull`, `docker compose up`, `docker compose down`, `docker compose run`, or `docker run --privileged`.
   - Squeal **never** uses `-v` (always `--mount type=bind,source=...,target=...`, which fails closed instead of creating root-owned directories on the host).
   - Squeal **never** stops or removes containers that do not carry `org.squeal.managed=true`.

### D5. Container runner-host transport and lifecycle (`src/core/runner-host/container/`)

Reuses Squeal's existing local `runner-host` protocol (`src/core/runner-host/protocol.ts`, `channel.ts`, `host.ts`) with a container launcher instead of SSH/remote sync:

1. **Managed idle container per `(worktree, target)`:**
   - Before spawning a runner host, Squeal inspects whether its labelled managed container (`org.squeal.managed=true`, `org.squeal.worktree=<worktreeId>`, `org.squeal.target=<targetName>`) is running and matches the current image ID and mounts.
   - If absent (or image ID changed), Squeal verifies `docker image inspect <image>` succeeds (refusing cleanly with `unknown` and a note if missing, never building or pulling), checks that every host bind-mount source path exists, and launches one idle container:
     ```text
     docker run -d --init --pull never \
       --name squeal-ct-<wt8>-<target>-<nonce> \
       --user <uid>:<gid> \
       --label org.squeal.managed=true \
       --label org.squeal.worktree=<worktreeId> \
       --label org.squeal.target=<targetName> \
       --label org.squeal.image=<imageId> \
       --network <network> \
       --mount type=bind,source=<worktreeRoot>,target=<worktreeRoot> \
       --mount type=bind,source=<squealBundleDir>,target=<squealBundleDir>,readonly \
       --mount type=bind,source=<worktreeCacheDir>,target=<worktreeCacheDir> \
       --mount type=bind,source=<worktreeLogRoot>,target=<worktreeLogRoot> \
       -e HOME=/tmp \
       -e PYTHONPYCACHEPREFIX=<worktreeCacheDir>/pycache \
       <imageId> \
       sleep infinity
     ```
   - **Same-path bind mounting:** Mounting `<worktreeRoot>` at `<worktreeRoot>` (and `<squealBundleDir>`, `<worktreeCacheDir>`, `<worktreeLogRoot>` at their identical paths) removes all host-to-container path translation. Every absolute path emitted by `squeal_pytest.py`, `node:test`, Vitest, or Jest is already a valid host path.
   - **Persistent bytecode cache:** `PYTHONPYCACHEPREFIX` points into `<worktreeCacheDir>/pycache` (agent-owned), eliminating the ~5 s uncompiled `.pyc` penalty across container restarts while keeping zero `.pyc` files in the worktree.
2. **Node 22.19+ preflight:**
   - Before starting `runner-host`, Squeal checks Node inside the container (`docker exec -i <id> node -p "process.versions.node"`).
   - If `node` is missing or `< 22.19.0`, Squeal stops and removes the managed container, marks the target's files `unknown`, and records one clear note naming the required Node version (`>= 22.19.0`) and the version found. No host binary is mounted.
3. **Spawning `runner-host` over `docker exec -i`:**
   - Uses `channelOf(spawn("docker", ["exec", "-i", containerId, "node", "--disable-warning=ExperimentalWarning", squealCliPath, "runner-host", worktreeRoot, "--runner", runner], { stdio: ["pipe", "pipe", "pipe"] }))`.
   - Works for every `HOST_RUNNERS` runner (`pytest`, `node-test`, `vitest`, and Spec 028 `jest`) with no file sync and no bundle copy.
   - Because `squeal runner-host` runs inside the container, it discovers the container's own Python/Node environment (`/pkgs/.venv`, etc.) natively.
4. **Cancellation, crash recovery, and container reaping:**
   - **In-flight cancel / deadline / crash:** Proven in `027-01` (`out/03*`): `cancel` RPC, stdin close, `docker exec` SIGKILL, and daemon SIGKILL all cause Docker to close the exec's stdin, triggering `host.ts` `stopAll` to SIGTERM then SIGKILL the batch process group inside the container.
   - **Idle exit & daemon shutdown:** When the runner host closes on `hostIdleMinutes` or daemon exit, Squeal runs `docker rm -f <containerId>` on its managed container.
   - **Startup sweep:** On daemon start (and `squeal stop`), Squeal lists containers labelled `org.squeal.managed=true` + `org.squeal.worktree=<worktreeId>` whose owning daemon PID is dead and removes them with `docker rm -f`.

### D6. Mount proof and rebuild detection (anti-stale-pass)

1. **Live bind-mount proof (`dev:inode`):**
   - Extend the `runner-host` `start` reply (additive optional field `rootStat?: { dev: number; ino: number }`) to return `statSync(worktreeRoot)` from inside the container.
   - The daemon compares `rootStat` against host `statSync(worktreeRoot)`. On Linux, a true bind mount has the exact same `(dev, ino)` (`027-01` Q4: `66306:215291` vs baked `56:2901237` vs wrong directory `66306:1618762511`).
   - If `(dev, ino)` differs, Squeal refuses the container immediately, removes it, marks files `unknown`, and writes a note naming the mount mismatch. Baked `COPY . /app` code can never produce a stale pass.
2. **Image rebuild detection:**
   - Before starting a tier on a container target, Squeal runs `docker image inspect --format '{{.Id}}' <imageRef>` (~16 ms).
   - If the resolved image ID differs from the managed container's `org.squeal.image` label, Squeal closes the runner host, removes the old managed container, starts a fresh one on the new image ID, re-reads `environment()`, and re-keys affected files before running.

### D7. Container environment key space and CI sharing

1. **Isolated container key space:**
   - Container results are keyed in their own environment key space (following Spec 026 D10's `remote-key` pattern, with zero `KEY_FORMAT_VERSION` raise required for non-container local runs). A container result never collides with a host result for the same worktree.
2. **Two keying modes (`containers.<name>.keyMode`):**
   - **`"build-content"` (default, decided 2026-11-26; enables CI sharing across separate `docker build` runs):**
     - For repositories like `saas-boilerplate` where CI and developers each run `docker build` separately (producing different `imageId`s for identical Dockerfiles and packages), the container environment descriptor hashes:
       1. The inside-container runner environment (interpreter version, installed Python/Node packages, config files),
       2. The container's OS package inventory (`dpkg-query -W -f='${Package}=${Version}\n'` sorted, or `apk info -vv` sorted) + `platform/arch`,
       3. The git blob hashes of every path listed in `dockerfileInputs` (for example `Dockerfile`, `uv.lock`, `pyproject.toml`),
       4. Effective container `ENV` (non-slot vars) and dependency service image tags/digests (when declared).
     - **CI sharing:** When CI runs `squeal ci record` / `squeal ci export` (Spec 018) inside the built container (with the same `keyMode: "build-content"` policy), the exported environment descriptor matches the developer's local container built from the same commit, so `squeal` imports and reuses CI passes cleanly via Spec 018 D10/D11. Two worktrees on the same host also share results automatically.
     - **Honest tradeoff:** Documented in `squeal status` (`container backend (build-content)`): misses only an unpinned non-packaged artifact fetched from an unchanged URL in a `Dockerfile` `RUN` step (every `Dockerfile` edit, `apt`/`apk` package change, and Python/Node package change re-keys cleanly).
   - **`"image-id"` (opt-in, strictest against untracked Dockerfile side-effects):**
     - Environment hash includes: exact container `imageId` (`sha256:...`), `repoDigest` (when image has a single registry `RepoDigests` entry and local/CI pulled that digest), inspected `dependencyServices` image IDs (when declared and reachable), container platform/arch, effective container `ENV` (non-slot vars), and the runner's own inside-container `environment()` hash.
     - **Sharing:** Every worktree on the **same host** using the same local image shares stored results automatically. CI exports (`refs/squeal/<sha>`, Spec 018) match automatically whenever CI and local pull the **same registry image digest**, not across separate `docker build` runs.
     - **Guarantee:** Any Dockerfile edit (even an untracked binary or `/etc/` file outside `dpkg`/`uv`) changes `imageId` and re-runs tests.
3. **Observability (`squeal status` and `squeal ps`):**
   - `squeal status` displays container targets, their state (`ready`, `unconsented`, `image-missing`, `node-too-old`, `mount-mismatch`, `docker-unreachable`), key mode (`image-id` or `build-content`), and container provenance on failures (`in container <target>`).
   - `squeal ps` lists Squeal-labelled managed containers (`org.squeal.managed=true`) beside local daemons and remote machines.

### D8. Proposed implementation waves

| Row | Wave | Design | Scope |
| --- | --- | --- | --- |
| 027-02 | Wave 1 | D1, D2 | Per-batch slot allocator (`SQUEAL_SLOT`, `SQUEAL_WORKTREE_SLOT`, `TOX_PARALLEL_ENV`), `slots` policy fields, and `{slot}`/`{slot0}`/`{worktreeSlot}` env templating with template-based keying |
| 027-03 | Wave 1 | D3 | Pytest D2 empty-build-stage editable refinement (`outsideEditables`) with strict fail-closed tests for real outside editables |
| 027-04 | Wave 2 | D4 | Container policy schema (`containers` + project `container` ref), user-local `~/.config/squeal/containers.json` consent loader, and `squeal setup` container consent wording |
| 027-05 | Wave 2 | D5, D6 | Container manager & `docker exec -i` runner-host channel (`src/core/runner-host/container/`), Node 22.19+ preflight, same-path `--mount`, `dev:inode` mount proof, image-ID rebuild check, and startup/exit label reaping |
| 027-06 | Wave 3 | D7 | Container environment key space (`build-content` default with `dpkg`/`apk` + `dockerfileInputs` for Spec 018 CI export/import + opt-in `image-id`), plus `squeal status` and `squeal ps` container reporting |
| 027-07 | Wave 4 | D8 | Automated E2E suite + dogfooding on a throwaway copy of `saas-boilerplate` (with Node 22+ Dockerfile, Postgres/Redis/stripemock Compose stack, parallel slot proof, CI export/import round-trip, and `lessons.md`) |

## Testing

- **Unit & integration (Stage 1, no Docker required):**
  - Concurrent pytest batches receive distinct `SQUEAL_SLOT` / `SQUEAL_WORKTREE_SLOT` / `TOX_PARALLEL_ENV`, release slots on exit and SIGTERM, respect `slots.max`, and compute identical keys across slots.
  - Env templating expands only `{slot}`, `{slot0}`, `{worktreeSlot}` and preserves raw JSON braces (`{"dbname":"workers_{worktreeSlot}"}`).
  - `outsideEditables` admits an empty `/pkgs` editable directory with zero `.py` files and still refuses any outside editable with real `.py` modules or pointing to another worktree.
- **Container integration (gated on Docker availability, run locally and on Linux CI):**
  - Consent gate: committed `containers` config without `~/.config/squeal/containers.json` runs zero `docker` commands and reports actionable `unconsented` note.
  - Missing image: refuses without building or pulling (`--pull never` + `image inspect`).
  - Node < 22.19 in image: refuses cleanly with version note and removes managed container.
  - Mount proof: wrong bind mount or baked `COPY . /app` fails `(dev, ino)` check and runs zero tests.
  - Cancellation: `cancel`, stdin EOF, `docker exec` SIGKILL, and daemon SIGKILL leave zero test processes in container; startup sweep removes orphaned Squeal-labelled containers.
  - Keying: `image-id` re-keys on any rebuild and shares across two worktrees on one host; `build-content` matches across two `--no-cache` builds of identical Dockerfiles and re-keys on a 1-line `Dockerfile` or package change; CI export/import (`squeal ci export` / import) matches under `build-content`.
  - Ownership: zero root-owned files created in worktree; missing mount source fails closed via `--mount`.
  - Key-format validity: `test/keys/key-format.test.ts` stays green with zero key drift for non-container projects.

## Open questions

1. ~~**Keying default vs CI sharing (`D7`)**~~ Decided 2026-11-26, the human: `"build-content"` is the default (enables CI sharing across separate `docker build` runs); `"image-id"` stays available opt-in.
2. **Compose service port/network discovery:** For projects using per-worktree Compose stacks, is user-local `networkOverride` / `composeProject` in `~/.config/squeal/containers.json` sufficient, or should Squeal read `COMPOSE_PROJECT_NAME` from the worktree's `.env`? (Owner: the human, at spec review.)
3. **Follow-up (out of scope for Spec 027):** Combining Spec 026 remote VMs (for example Agent37 EU `vm`) with Spec 027 containers by routing `docker exec -i` over the VM's SSH channel and mounting the VM's synced tree into the container. Both layers share `HostChannel` and `build-content` keys, so a future row can compose them without rewriting either spec.

## References

- Research: `research/docker-execution.md` (027-01, 2026-11-26) and `../007-pytest-runner/research/tests-in-docker.md` (007-58, 2026-10-28).
- Related specs: `007-pytest-runner` (D1, D2, D6; row `007-60`), `011-core` (C3, C14), `018-ci-and-shared-results` (D10, D11), `021-remote-store-and-execution` (D6, D8), `026-tiered-and-cloud-execution` (D6, D10, D12).
- Reference project: `https://github.com/apptension/saas-boilerplate` at `caa46d26`.
