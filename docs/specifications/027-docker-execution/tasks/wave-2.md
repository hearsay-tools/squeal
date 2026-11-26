# Spec 027 Wave 2: Container policy, consent, and container runner-host manager

Reads before starting: `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/027-docker-execution/spec.md` (D4, D5, D6), `docs/specifications/027-docker-execution/research/docker-execution.md`.

Hard rules for both rows:
- Stay strictly inside your file ownership below; rows `027-04`, `027-05`, `028-03`, and `028-04` run in parallel on the same baseline.
- Do not run `pnpm run build`, and do not edit `package.json`, `install.sh`, `plugins/`, or `docs/board.md`.
- Do not bump `KEY_FORMAT_VERSION`, any adapter version, or `RECORDER_VERSION`.
- Verify `pnpm exec vitest run test/keys/key-format.test.ts` passes locally (zero uncovered changed lines, zero differing outputs against the last release), plus your targeted tests, `pnpm run lint`, and `pnpm run typecheck`.
- Never run a full test suite. Never commit absolute home paths or private names (`pnpm run check:private origin/main`). Never use em-dashes in docs or comments.

---

## Row 027-04: Container policy schema, user-local consent, and setup wording (D4)

**Goal:** Add declarative `containers` targets and project `container` references to `squeal.config.json` policy loading, implement the user-local opt-in consent loader (`~/.config/squeal/containers.json`), and add clear root-equivalent Docker consent wording for `squeal setup`.

**File ownership (strictly disjoint):**
- `src/core/types/policy-containers.ts` (new)
- `src/core/types/policy.ts`
- `src/core/daemon/policy-containers.ts` (new)
- `src/core/daemon/policy.ts`
- `src/core/daemon/policy-pytest.ts`
- `src/core/daemon/policy-node-test.ts`
- `src/core/runner-host/container/consent.ts` (new)
- `src/cli/setup/containers.ts` (new)
- `src/cli/setup/format.ts` (only if wiring setup display/warning for declared `containers`)
- `test/daemon/policy-containers.test.ts` (new)
- `test/runner-host/container/consent.test.ts` (new)
- `test/cli/setup-containers.test.ts` (new)
- `test/keys/validity/cases/policy-containers.ts` (new, if needed for `key-format.test.ts` line coverage)
- `test/keys/validity/cases/index.ts` (only to register `policy-containers.ts` if added)

**Requirements:**
1. **Declarative policy (`src/core/types/policy-containers.ts`, `src/core/daemon/policy-containers.ts`, `src/core/types/policy.ts`, `src/core/daemon/policy.ts`):**
   - `ContainerKeyMode = "build-content" | "image-id"`.
   - `ContainerTarget`:
     - `image: string` (required non-empty string, no whitespace/control chars, no leading `-`)
     - `network?: string` (optional non-empty string, no whitespace/control chars, no leading `-`; supports `{composeProject}` template resolved from user-local consent)
     - `workdir?: string` (optional POSIX absolute path inside container)
     - `keyMode: ContainerKeyMode` (default `"build-content"`, per Spec 027 D4/D7 human decision)
     - `dockerfileInputs: readonly string[]` (default `[]`, repo-relative paths without `..` escape or leading `/`)
     - `dependencyServices: readonly string[]` (default `[]`, non-empty service names without whitespace/control chars or leading `-`)
     - `env: Readonly<Record<string, string>>` (default `{}`)
   - Add `readonly containers: Readonly<Record<string, ContainerTarget>>` to `Policy`, with `DEFAULT_POLICY.containers = {}`.
   - Follow 001 D11 loader rules (`src/core/daemon/config-file.ts`): bad target entries produce one problem and are dropped while valid targets are kept; unknown keys inside a target are reported. Target names must be safe non-empty identifiers (no whitespace, `/`, `\`, or leading `-`).
   - Add optional `readonly container?: string` on `PytestProject` and `NodeTestProject` (accepted by `policy-pytest.ts` and `policy-node-test.ts`; reject non-string or empty string). Note `JestProject` already has optional `container?: string` in `src/core/types/policy-jest.ts` (do not touch `policy-jest.ts` unless needed).
   - Cross-check in `loadPolicy`: if a project names `container: "<name>"` that is not in `containers`, report a policy problem (keeping the loader non-throwing).
2. **User-local consent (`src/core/runner-host/container/consent.ts`):**
   - Follow `src/core/runner-host/remote/settings.ts` closely: read `$XDG_CONFIG_HOME/squeal/containers.json` via `userConfigPath(env)` (`~/.config/squeal/containers.json`), never committed.
   - Schema:
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
   - Match repository by canonical `realpath(repositoryRoot)` first, then by any Git remote URL from `commonDir` (same pattern as `remoteLaneFor`).
   - Export `loadContainerConsent(env?)`, `containerConsentFor(settings, repositoryRoot, commonDir)`, `isTargetConsented(consent, targetName)`, `resolveContainerNetwork(target, consent)` (applying `networkOverride` over `target.network`, expanding `{composeProject}` when set, refusing cleanly if `{composeProject}` is used without `composeProject`), and `unconsentedNote(project, targetName, settingsPath)` explaining clearly that container mode needs local opt-in via `squeal setup` and warning that Docker socket access is root-equivalent on the host.
   - Consent loader NEVER spawns `docker`.
3. **Setup consent wording (`src/cli/setup/containers.ts`):**
   - Provide clean helpers to format the container consent warning and `containers.json` opt-in entry for `squeal setup`: clearly warn that granting Docker socket access is root-equivalent on the host, list declared target images/networks from `squeal.config.json`, and never auto-enable consent without explicit user opt-in.
4. **Tests & key validity:**
   - Test valid and invalid `containers` policies, default `keyMode: "build-content"`, opt-in `"image-id"`, unknown target references, project `container` field parsing, `containers.json` matching by root and remote URL, target allow-list filtering, `networkOverride` and `{composeProject}` expansion, missing/disabled consent producing `unconsentedNote` with zero `docker` calls, and setup consent wording.
   - Run `pnpm exec vitest run test/daemon/policy.test.ts test/daemon/policy-containers.test.ts test/runner-host/container/consent.test.ts test/cli/setup-containers.test.ts test/keys/key-format.test.ts` and `pnpm run lint && pnpm run typecheck`.

---

## Row 027-05: Container manager and `docker exec -i` runner-host channel (D5, D6)

**Goal:** Build the managed container lifecycle, security invariants, Node 22.19+ preflight, live bind-mount `dev:inode` proof, image-ID rebuild check, `docker exec -i` `HostChannel` transport, and orphan container reaping.

**File ownership (strictly disjoint):**
- `src/core/runner-host/protocol.ts`
- `src/core/runner-host/host.ts`
- `src/cli/runner-host.ts`
- `src/core/runner-host/container/docker.ts` (new)
- `src/core/runner-host/container/preflight.ts` (new)
- `src/core/runner-host/container/manager.ts` (new)
- `src/core/runner-host/container/index.ts` (new; do NOT create or touch `consent.ts`)
- `test/runner-host/container/docker-args.test.ts` (new)
- `test/runner-host/container/lifecycle.test.ts` (new)

**Requirements:**
1. **Additive `rootStat` on `HostStarted` (`src/core/runner-host/protocol.ts`, `src/core/runner-host/host.ts`, `src/cli/runner-host.ts`):**
   - Add optional `readonly rootStat?: { readonly dev: number; readonly ino: number }` to `HostStarted`.
   - Populate it from `statSync(root)` inside `serveRunnerHost` (via optional `root?: AbsolutePath` or `rootStat?: () => { dev: number; ino: number } | undefined` on `ServeOptions`, wired from `src/cli/runner-host.ts`). Never break existing local or remote callers or tests.
2. **Narrow Docker CLI guard (`src/core/runner-host/container/docker.ts`):**
   - Expose a clean, injectable `DockerCli` interface (defaulting to `docker` via `execFile`/`spawn`) supporting ONLY:
     - `imageInspect(image)` (`docker image inspect --format '{{json .}}' -- <image>`) -> `{ id, repoDigests, env, architecture, os }` or `null` when missing
     - `runIdle(spec)` (`docker run -d --init --pull never ... <imageId> sleep infinity`)
     - `execSyncText(containerId, argv, timeoutMs?)` (`docker exec -i <containerId> ...`)
     - `spawnExec(containerId, argv)` (`spawn("docker", ["exec", "-i", containerId, ...argv], { stdio: ["pipe", "pipe", "pipe"] })`)
     - `psManaged(filters)` (`docker ps -a --filter label=org.squeal.managed=true ...`)
     - `removeManaged(containerId)` (verifies or only targets managed container IDs: `docker rm -f -- <containerId>`)
   - Hard runtime guard in arg builder: assert NO `build`, `pull`, `compose`, `--privileged`, or `-v`/`--volume` flags can ever be emitted; always use `--mount type=bind,source=...,target=...[,readonly]`, `--init`, `--pull never`, and `--user <uid>:<gid>` (from `process.getuid()` / `process.getgid()`).
   - Always verify every host bind-mount source path exists via `existsSync` BEFORE running `docker run`, failing closed with a clear error instead of letting Docker create a directory.
3. **Preflight, mount proof, and rebuild detection (`src/core/runner-host/container/preflight.ts`):**
   - **Node 22.19+ preflight:** Run `node -p "process.versions.node"` inside the container; parse semver and require `>= 22.19.0`. If missing or `< 22.19.0`, return typed refusal `{ ok: false, state: "node-too-old", found, note }` naming `>= 22.19.0` and the version found. Never mount a host Node binary.
   - **Live bind-mount proof (`dev:inode`):** Compare host `statSync(worktreeRoot)` `(dev, ino)` against container `HostStarted.rootStat` `(dev, ino)`. If missing or unequal, return typed refusal `{ ok: false, state: "mount-mismatch", note }`.
   - **Image rebuild check:** Compare current `docker image inspect --format '{{.Id}}' <image>` (~16 ms) against the running managed container's `org.squeal.image` label; report `{ changed: true, imageId }` when rebuilt or `{ missing: true }` when untagged/removed.
4. **Managed idle container lifecycle & `docker exec -i` channel (`src/core/runner-host/container/manager.ts`):**
   - Labels on every managed container:
     - `org.squeal.managed=true`
     - `org.squeal.worktree=<worktreeId>`
     - `org.squeal.target=<targetName>`
     - `org.squeal.image=<imageId>`
     - `org.squeal.pid=<process.pid>`
   - Container name: `squeal-ct-<wt8>-<sanitizedTarget>-<nonce>`.
   - Same-path bind mounts (`--mount type=bind`):
     - `worktreeRoot` -> `worktreeRoot` (rw)
     - `squealBundleDir` -> `squealBundleDir` (readonly)
     - `worktreeCacheDir` -> `worktreeCacheDir` (rw)
     - `worktreeLogRoot` -> `worktreeLogRoot` (rw)
   - Default env flags: `-e HOME=/tmp`, `-e PYTHONPYCACHEPREFIX=<worktreeCacheDir>/pycache`, plus target `env` entries.
   - `ensureContainer(...)`: checks `imageInspect(image)` (if missing -> typed `image-missing` refusal, never pulls/builds); reuses running managed container if `org.squeal.image === imageId`, else removes old managed container and starts a new one; runs Node 22.19+ preflight (if it fails, removes the managed container immediately before returning refusal!).
   - `openRunnerHostChannel(container, { squealCliPath, worktreeRoot, runner })`: spawns `docker exec -i <containerId> node --disable-warning=ExperimentalWarning <squealCliPath> runner-host <worktreeRoot> --runner <runner>` wrapped in `channelOf(...)` (`src/core/runner-host/channel.ts`), plus `verifyMount(hostRoot, started.rootStat)` helper that tears down the channel and removes the managed container on mismatch.
   - `close()`: stops and removes the managed container (`docker rm -f`), never touching containers without `org.squeal.managed=true`.
   - `reapOrphanedContainers(worktreeId, isPidAlive?)`: lists `org.squeal.managed=true` + `org.squeal.worktree=<worktreeId>` containers whose `org.squeal.pid` is dead (`process.kill(pid, 0)` ESRCH) and removes them with `docker rm -f`.
5. **Tests:**
   - Unit tests (`test/runner-host/container/docker-args.test.ts`): verify every CLI invariant (`--init`, `--pull never`, `--user`, `--mount`, no `-v`, no `--privileged`, no `build`/`pull`/`compose`), missing mount source fail-closed, Node 22.19+ semver boundary (`22.18.9` refused, `22.19.0` and `24.0.0` admitted, missing node refused), `dev:inode` match/mismatch refusal, image rebuild detection, and orphan reaping with fake `DockerCli`.
   - Real Docker integration tests (`test/runner-host/container/lifecycle.test.ts`): gated cleanly on Docker availability (`docker info`), testing real container label creation, missing-image refusal (without pulling), same-path `--mount`, zero root-owned files created in a temp worktree, and `reapOrphanedContainers` / `close()` leaving zero containers behind (check existing local images first with `docker images`; if a Node 22+ image exists locally, also prove a real `docker exec -i` `dev:inode` check; never pull images from the internet in tests!).
   - Run `pnpm exec vitest run test/runner-host/container/docker-args.test.ts test/runner-host/container/lifecycle.test.ts test/runner-host/protocol.test.ts test/keys/key-format.test.ts` and `pnpm run lint && pnpm run typecheck`.
