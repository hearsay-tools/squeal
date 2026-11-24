# Spec 026 Wave 3 briefs (Track 2: remote planning + `agent37` provider)

Spec: `docs/specifications/026-tiered-and-cloud-execution/spec.md` (stage: `approved`).
Prior reviews: `reviews/0.1.617.md` (FAIL, repaired) and `reviews/0.1.617-r2.md` (PASS on `03990aa0c`, 0 findings, landed as `0.1.617` at `a5c523600`).

Both rows below have strictly disjoint file ownership and run in parallel.
Workers: follow `/worker` skill, read `AGENTS.md`, `docs/vision.md`, `docs/styleguide.md`, `spec.md`, and `reviews/0.1.617-r2.md` ("What fits and inputs for the next wave"). Test first. Do NOT run `pnpm run build`, do NOT bump versions, do NOT edit `docs/board.md`, and do NOT run a local full suite. Use Squeal (`squeal status --wait 60000 <changed-paths>`), targeted `pnpm exec vitest run <test-files>`, `pnpm run lint`, and `pnpm run typecheck`.

---

## Row 026-12: Hybrid 2A: remote planning (`planning: "remote"`) and `hasGitRepository` D19 bypass

- **Design:** Spec 026 D8 items 3 & 4 (`spec.md` lines 255-260) and `reviews/0.1.617-r2.md` lines 176-179.
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/runner-host/remote/lane.ts`
  - `src/core/runner-host/remote/daemon-lane.ts`
  - `src/core/runner-host/remote/lane-compare.ts`
  - `src/core/runner-host/remote/lane-repository.ts`
  - `src/core/runner-host/remote/machine-share.ts`
  - `src/core/runner-host/remote/connect.ts` (only if needed to expose capability/warm hook; do NOT touch `providers/` or `tree-host.ts`)
  - Tests under `test/runner-host/remote/` (NOT `providers/` and NOT `machines-lock.test.ts` or `tree-host*.test.ts`).
  - Do NOT edit `src/core/runner-host/remote/providers/`, `src/cli/main.ts`, or `src/cli/remote-tunnel.ts` (`026-15` owns them).
- **Requirements:**
  1. **Zero local runner hosts while remote is active under `planning: "remote"`:**
     - Notice `settings.ts` already parses `lane.planning: "local" | "remote"` (defaulting to `"remote"` when `lanes` includes `"edit"`, else `"local"`).
     - When `planning === "remote"`:
       - Route `testFiles()`, `environment()`, `affected(paths)`, `closure(file)`, and `enumerate(file)` to the remote runner host (sending any pending `invalidate` paths to the remote host first so remote planning always sees the current revision's files!).
       - Wait for an in-flight connect (or initiate connect if asleep / retry due, respecting `MachineEnding` and shutdown boundaries from `reviews/0.1.617-r2.md`!) before falling back.
       - **CRITICAL — do NOT call `local.environment()` or `local.closure()` while `planning === "remote"` and remote is ready!** Look at `lane-compare.ts` (`differences`) and `lane.ts` (`remoteRun` lines 233-235): today both call `local.environment()` and `local.closure(file)`, which would spawn a local Vitest/node:test/pytest runner host!
         - Under `planning: "remote"` (with `environmentMode: "match-local"`), `compareRemote` must compare the remote's `coreEnvironment` (`node`, `platform`, `arch`, `installedDependencies`, `squealVersion`, allowlisted env vars) against local `coreEnvironmentInputs` AND compare the blob IDs of the remote's reported config files (`remoteRunners.flatMap(r => r.files)`) against local disk blobs `blobsAt(root, files)`, WITHOUT calling `local.environment()`!
         - In `remoteRun`, when `planning === "remote"`, compute proof `inputs` from `host.adapter.closure(file)` and `host.adapter.environment()` (never calling `local.closure` or `local.environment`!).
       - **Warm first `affected` on connect (D8.3):** when `planning === "remote"`, warm `host.adapter.affected([])` during connect (inside the connect/signal boundary so shutdown cancels/closes cleanly!) before reporting ready.
       - **Fallback when remote is `down` (unreachable or refused):**
         - `whenLost === "local"`: lazily fall back to `local` for `testFiles()`, `environment()`, `affected()`, `closure()`, `enumerate()`, and runs.
         - `whenLost === "not-run"`: do NOT call `local` (zero local runner host spawned!); reject planning calls with a clear error naming the unreachable/refused remote so the scheduler marks files `unknown` honestly (vision principle 2).
       - Note on `invalidate(paths)`: when `planning === "remote"` and no local runner host has been opened, do NOT wake `local` by calling `local.invalidate(paths)`! Only forward `invalidate` to `local` if `local` was actually used/opened (or track `localUsed`), so edits while remote is active make **zero** calls on `local`!
  2. **Repository-reading tests (`hasGitRepository`, D8.4):**
     - Pass whether the acquired machine has `capabilities.hasGitRepository === true` into the lane / `repositoryRoute`.
     - When `hasGitRepository` is `true`, do NOT pre-split `remote.needsRepository` files to `here` — send them to the remote machine alongside other files (so zero local runner host is forced for git-reading tests when the remote tree is a real Git repo, e.g. Agent37 `git-bundle` or `command` provider with `hasGitRepository: true`).
     - Keep D19.2's post-run `route.guard(report)` active even when `hasGitRepository` is `true`: if a remote test still unexpectedly fails with Git's `fatal: not a git repository` diagnostic, discard that false failure, remember that file as local-only for this session, and rerun it locally (or respect `whenLost`).
  3. **Shutdown & sleep safety (`reviews/0.1.617-r2.md`):**
     - Remote planning calls in flight must count as active remote work (so `sleep()` refuses while a planning call is in flight and `activity()` resets the idle sleep clock).
     - Shutdown (`close()` / `release()`) stops queued/new remote planning work cleanly and never starts a host after `release()`.
  4. **Backward compatibility:**
     - Preserve 100% of `planning: "local"` behavior (the default for `{ "target": "build-box" }` and `lanes: ["background"]`).
     - Keep `coverage` stripped and `environmentMode: "match-local"` unchanged (`026-13` and `026-14` extend those in the next wave).
- **Done when:**
  - Tests prove: (a) under `planning: "remote"`, `testFiles`/`environment`/`affected`/`closure`/`enumerate`/`invalidate`/`run` execute completely on the remote with **0 calls** to `local` (asserting spy `local` has 0 calls across start, edits, and runs!); (b) remote `affected([])` warms on connect; (c) when remote is `down`, `whenLost: "local"` falls back to `local` while `whenLost: "not-run"` makes 0 calls to `local` and surfaces the failure; (d) `hasGitRepository: true` sends `needsRepository` files to the remote while keeping D19's unexpected-error guard active; (e) in-flight remote planning blocks `sleep()` and respects shutdown.
  - All existing `test/runner-host/remote/*.test.ts` pass; `pnpm run lint` and `pnpm run typecheck` pass.

---

## Row 026-15: `agent37` provider (EU `vm`, local git-bundle bootstrap, proxy tunnel, sleep/wake)

- **Design:** Spec 026 D7.3 & D12.6 (`spec.md` lines 222-248, 299) + `research/agent37-sandboxes.md` + `research/probes/agent37-sandboxes/tunnel.mjs`.
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/runner-host/remote/providers/agent37/` (new directory: e.g., `index.ts`, `config.ts`, `api.ts`, `bootstrap.ts`, `tunnel.ts`)
  - `src/core/runner-host/remote/providers/index.ts` (register `agent37: agent37Provider`)
  - `src/cli/remote-tunnel.ts` (new CLI subcommand `squeal remote-tunnel agent37 <instance-id>`)
  - `src/cli/main.ts` (ONLY register `"remote-tunnel": remoteTunnelCommand` as a hidden internal subcommand beside `"store-process"`, without altering `HELP` text!)
  - Tests: `test/runner-host/remote/providers/agent37*.test.ts`, `test/cli/remote-tunnel.test.ts` (and update `test/runner-host/remote/settings.test.ts` ONLY if it asserts the exact `PROVIDER_KINDS` list — check first!).
  - Do NOT edit `lane.ts`, `daemon-lane.ts`, `lane-compare.ts`, `lane-repository.ts`, `machine-share.ts`, `machines-store.ts`, or `tree-host.ts`.
- **Requirements:**
  1. **Built-in proxy-aware WebSocket tunnel (`squeal remote-tunnel agent37 <instance-id>`):**
     - Implement in `src/cli/remote-tunnel.ts` (with testable core module under `src/core/runner-host/remote/providers/agent37/tunnel.ts`), adapted cleanly from `research/probes/agent37-sandboxes/tunnel.mjs`:
       - Accepts `agent37 <instance-id>` plus optional `--api-key-env <ENV_NAME>` (default `AGENT37_API_KEY`) and `--host <hostname>` / `--port <port>` (for mock testing; default host `<instance-id>-22022.agent37.app`, port `443`, plus `--plain` or `http://` only if needed for local mock tests — actually TLS with self-signed CA via `NODE_EXTRA_CA_CERTS` is even better because it tests the real TLS + `NODE_EXTRA_CA_CERTS` path!).
       - Reads the API key ONLY from `env[apiKeyEnv]` — NEVER accepts the key as a CLI flag, NEVER logs or prints the key or proxy credentials! When `HTTPS_PROXY` / `https_proxy` is set and `env[apiKeyEnv]` is unset (as under an injecting proxy like `agent-vault`), send `X-Agent37-Key: placeholder` (or fail clearly with exit 255 if neither key env nor `HTTPS_PROXY` is present).
       - Honors `HTTPS_PROXY` / `https_proxy` and `NO_PROXY` / `no_proxy` (case-insensitive; supports suffix/exact/wildcard matching). Through a proxy: HTTP `CONNECT <host>:<port>` (with Basic `Proxy-Authorization` if proxy URL carries userinfo, never logged) then TLS upgrade over the tunnel socket; without a proxy: direct `tls.connect`. Always honors `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`.
       - Performs RFC 6455 WebSocket upgrade (`Upgrade: websocket`, `Sec-WebSocket-Key`, validates `101` + `Sec-WebSocket-Accept`), then bridges binary frames (`opcode 2`) between `stdin`/`stdout` and the TLS socket, handling `ping` (`9` -> `pong` `10`), `close` (`8`), fragmented/multi-byte length frames (`<126`, `16-bit`, `64-bit`), and backpressure.
  2. **`agent37` `RemoteMachineProvider` (`src/core/runner-host/remote/providers/agent37/`):**
     - Register as `"agent37"` in `src/core/runner-host/remote/providers/index.ts`.
     - **Config validation (`validate(config)`):**
       - Keys: `region` (`"eu"` default | `"us"` | `"ap-south"`), `type` (`"vm"` default | `"performance"` | `"default"`), `vcpu` (positive int, default `4`), `memoryGb` (positive int, default `8`), `diskGb` (positive int, default `10`), `autoSleepMinutes` (number >= 1, default `10`), `apiKeyEnv` (non-empty env var name string, default `"AGENT37_API_KEY"`), `sshKeyPath` (optional non-empty string), `bootstrap` (`"git-bundle"` default | `"tree-sync"`), `apiBaseUrl` (optional valid `http:`/`https:` URL string, default `"https://api.agent37.com"`), `tunnelHostTemplate` (optional string with `{id}` placeholder, default `"{id}-22022.agent37.app"`), `node`, `cache`.
       - Reject unknown keys and bad types cleanly (`unknownKey`, `placesProblem` from `providers/config.ts`).
       - Explicitly reject `region: "eu"` with `type: "default"` (`Agent37 EU does not support "default" (gVisor); use "vm" or "performance"`).
       - In `acquire()`, log a warning via `request.log` if `type: "default"` is explicitly configured in `us` (3-4x slower gVisor).
     - **Proxy-aware Agent37 HTTP client (`api.ts`):**
       - Calls `apiBaseUrl` honoring `HTTPS_PROXY`/`NO_PROXY` and `NODE_EXTRA_CA_CERTS`/`SSL_CERT_FILE` (use Node `http`/`https` with `CONNECT` tunnel when `HTTPS_PROXY` applies and `apiBaseUrl` is `https:`, or direct `http`/`https` otherwise — zero external deps!).
       - Sends `X-Agent37-Key` from `env[apiKeyEnv]` (or `"placeholder"` only when `HTTPS_PROXY` is set and key env is unset; fails clearly before network call if neither is set). Never includes the key in logs or error messages.
       - Endpoints (matching `research/agent37-sandboxes.md`):
         - `GET /v1/instances/<id>` (inspect status: `running`, `sleeping`, `starting`, etc., or `404` if gone)
         - `POST /v1/instances` (`{ region, type, vcpu, memory_gb, disk_gb, auto_sleep }` -> returns `{ id, ... }`)
         - `POST /v1/instances/<id>/sleep` (stops compute billing immediately)
         - `POST /v1/instances/<id>/exec` (optional fast wake / readiness check)
         - `DELETE /v1/instances/<id>` (on `release("worktree-removed")`, treating `404` as already deleted)
     - **`acquire(request, config)` and `reattach(record, config, env)`:**
       - Check `readMachines(env)` for an existing tracked record matching `("agent37", request.worktreeId)`. If found and `GET /v1/instances/<id>` succeeds (not 404), reuse it (calling `wake()` if sleeping!) instead of creating a duplicate VM!
       - Otherwise `POST /v1/instances` and poll `GET /v1/instances/<id>` until ready (bounded timeout, respecting clean errors).
       - Build `SshTarget`:
         - `destination`: e.g. `root@<id>` (or `agent37` SSH user `root@<id>.agent37` — check `agent37-sandboxes.md` for the exact SSH user! Read `research/agent37-sandboxes.md` before coding!).
         - `args`: `-o ProxyCommand=<quoted node> --disable-warning=ExperimentalWarning <quoted cli> remote-tunnel agent37 <id> [--api-key-env ...] [--host ...]` (never putting secrets in `ProxyCommand`!), `-o StrictHostKeyChecking=no`, `-o UserKnownHostsFile=/dev/null`, and `-i <sshKeyPath>` when configured.
       - **Local `git-bundle` bootstrap (`bootstrap === "git-bundle"`):**
         - When provisioning a fresh instance (or if `<remote tree>/root/.git` does not yet exist on reuse): create a local `git bundle create <tmp> HEAD` (plus tags if present, cleaned up in `finally`), stream it over SSH into the remote tree directory, clone/extract into `<remote tree>/root` (using `treeDir(places, request.worktreeRoot)`!), and ensure matching Node if absent (when not already present). Zero git credentials ever sent to the VM!
         - Set `capabilities: { hasGitRepository: bootstrap === "git-bundle", sleepOnIdle: true, ephemeralHostKey: true }`.
       - Store `{ instanceId, region, type, bootstrap }` in `MachineRecord.state` so `reattach(record, config, env)` works cleanly for `squeal remote sleep` and `squeal remote prune` with zero daemon running!
       - **Lifecycle methods on `RemoteMachine`:**
         - `sleep()`: `POST /v1/instances/<id>/sleep`.
         - `wake()`: inspect `GET /v1/instances/<id>`; if `sleeping`, wake via `POST /v1/instances/<id>/exec` (or wake endpoint) and wait until `running`; if `404` (deleted/rebuilt), throw a clear error naming the missing instance so the lane/caller knows it was lost.
         - `release("idle")` / `release("daemon-exit")`: call `sleep()`.
         - `release("worktree-removed")`: call `DELETE /v1/instances/<id>` (404-safe).
  3. **Tests (zero real network, zero real credentials, zero real `~/.ssh`):**
     - Local mock HTTPS + WebSocket + HTTP `CONNECT` proxy server test in `test/cli/remote-tunnel.test.ts` (real TLS using generated ephemeral self-signed cert passed via `NODE_EXTRA_CA_CERTS`, testing direct TLS, proxied `CONNECT`, `NO_PROXY` bypass, binary round-trip, ping/pong, close, and verifying API key comes from env and never appears in argv/logs).
     - Local mock Agent37 API + fake `ssh` tests in `test/runner-host/remote/providers/agent37.test.ts` covering validation (`eu` + `default` rejected), create, reuse of existing instance from `remote-machines.json`, `git-bundle` bootstrap over fake SSH (`hasGitRepository: true`, real git bundle unpacked cleanly), `sleep`, `wake` from sleeping, `404` on deleted/rebuilt instance, `release("daemon-exit")` -> sleep, `release("worktree-removed")` -> `DELETE`, and `reattach` through `squeal remote sleep` & `squeal remote prune`.
- **Done when:**
  - All new `agent37` provider and `remote-tunnel` tests pass with zero real network calls and `pnpm run check:private` clean.
  - Existing `test/runner-host/remote/settings.test.ts` and `test/cli/remote.test.ts` pass; `pnpm run lint` and `pnpm run typecheck` pass.
