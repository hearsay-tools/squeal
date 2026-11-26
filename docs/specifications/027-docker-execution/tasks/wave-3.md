# Spec 027 Wave 3: Container environment key space, live container runner wiring, and status/ps visibility

Reads before starting: `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/027-docker-execution/spec.md` (D5, D6, D7), `docs/specifications/027-docker-execution/reviews/0.1.643.md` (N2, N3, Inputs for the next wave), `src/core/runner-host/remote/remote-key.ts`, `src/core/status/remote-status.ts`, `src/core/daemon/container-guard.ts`.

Hard rules:
- Stay strictly inside your file ownership below; row `028-05` runs in parallel on the same baseline and owns `src/core/types/policy.ts`, `src/core/daemon/policy.ts`, `src/core/daemon/policy-containers.ts`, `src/core/runner-host/{protocol,runners,proxy,process-host}.ts`, and `src/runners/jest/`.
- Do not run `pnpm run build`, and do not edit `package.json`, `install.sh`, `plugins/`, or `docs/board.md`.
- Do not bump `KEY_FORMAT_VERSION`, any adapter version, or `RECORDER_VERSION`. Non-container local keys must remain byte-identical (`test/keys/key-format.test.ts` must pass 12/12 locally).
- Do not set timers waiting on a large Squeal background backlog; read `squeal status --wait 60000` once and report any remaining pending count honestly.
- Never run a full test suite. Never commit absolute home paths or private names. Never use em-dashes in docs or comments.

---

## Row 027-06: Container key space, live container runner, and status/ps visibility (D7 + N2/N3)

**Goal:** Implement the isolated container environment key space (`build-content` default for Spec 018 CI sharing + opt-in `image-id`), wire consented container projects in the daemon through the container manager and `docker exec -i` runner host (with launch-stamp reuse N3), and report container targets and managed containers in `squeal status` and `squeal ps`.

**File ownership (strictly disjoint from row `028-05`):**
- `src/core/runner-host/container/key.ts` (new)
- `src/core/runner-host/container/runner.ts` (new)
- `src/core/runner-host/container/manager.ts`
- `src/core/runner-host/container/index.ts`
- `src/core/daemon/container-guard.ts`
- `src/core/daemon/node-test-runners.ts`
- `src/core/daemon/pytest-runners.ts`
- `src/core/daemon/daemon.ts`
- `src/core/types/status.ts`
- `src/core/status/container-status.ts` (new)
- `src/core/status/snapshot.ts`
- `src/core/status/format-status.ts`
- `src/core/ps/containers.ts` (new)
- `src/core/ps/snapshot.ts`
- `src/core/ps/render.ts`
- `src/core/ps/shape.ts`
- `test/runner-host/container/key.test.ts` (new)
- `test/runner-host/container/runner.test.ts` (new)
- `test/runner-host/container/lifecycle.test.ts`
- `test/daemon/container-guard.test.ts`
- `test/status/container-status.test.ts` (new)
- `test/ps/containers.test.ts` (new)

**Requirements:**
1. **Launch-stamp container reuse (review 0.1.643 N3, `src/core/runner-host/container/manager.ts`):**
   - Compute a deterministic `org.squeal.config` label (short SHA-256 stamp of effective mounts, network, workdir, and container env) on every managed container.
   - Only reuse a running managed container when PID, running state, `org.squeal.image`, AND `org.squeal.config` all match; otherwise remove the old managed container and start a fresh one.
2. **Isolated container environment key space (`src/core/runner-host/container/key.ts`):**
   - Container results MUST NEVER collide with host results for the same worktree, and non-container keys MUST remain unchanged (zero `KEY_FORMAT_VERSION` bump).
   - Support both modes (`target.keyMode`, defaulting to `"build-content"`):
     - **`"build-content"` (default, enables Spec 018 CI sharing across separate `docker build` runs):**
       Hashes into an isolated container environment descriptor (folded into the container `RunnerEnvironment`'s `resolvedConfig` + `core` machine tuple from inside the container, so `environmentHash` keys it distinctly without changing `KEY_FORMAT_VERSION` and works identically when `squeal ci export`/`import` runs inside the built container!):
       1. Inside-container OS package inventory: `dpkg-query -W -f='${Package}=${Version}\n'` sorted (Debian/Ubuntu) or `apk info -vv` sorted (Alpine), plus container `os`/`arch` and Node version,
       2. Content hashes of every repo-relative file listed in `target.dockerfileInputs` (missing files hashed distinctly as missing),
       3. Effective container `ENV` (excluding slot variables `SQUEAL_SLOT`, `SQUEAL_WORKTREE_SLOT`, `TOX_PARALLEL_ENV`),
       4. Optional `target.dependencyServices` image tags/digests (inspected via `docker ps` / `docker image inspect` when declared and reachable, never starting Compose).
     - **`"image-id"` (opt-in strictest local pinning):**
       Includes exact container `imageId` (`sha256:...`), single registry `repoDigest` (when present), inspected `dependencyServices` image IDs (when declared), container `os`/`arch`, effective non-slot container `ENV`, and inside-container runner environment.
   - Include a helper `applyContainerEnvironment(environments, descriptor, containerCore)` that wraps each `RunnerEnvironment` from the inside-container runner host cleanly (adding container provenance/key descriptor and tagging `core` with the container's `CoreEnvironmentInputs` following `remote-key.ts`).
3. **Live container runner (`src/core/runner-host/container/runner.ts`) and daemon wiring (`container-guard.ts`, `node-test-runners.ts`, `pytest-runners.ts`, `daemon.ts`):**
   - In `container-guard.ts`:
     - Keep unconsented / disabled / wrong-target projects fail-closed with zero `docker` calls and `unconsentedNote(...)` (preserving B1 guarantee 100%!).
     - When consent IS granted AND container wiring options are provided (`containers`, `worktreeId`, `bundleDir`, `stateDir`, `logRoot`, `commonDir`, `squealCliPath`), route the project to `createContainerRunner(...)` (`src/core/runner-host/container/runner.ts`) instead of the host/remote adapter!
     - If consent is granted in a minimal test call without container runtime options, stay fail-closed (never fall back to host or remote!).
   - In `createContainerRunner(...)`:
     - Uses `ensureContainer` -> `openRunnerHostChannel` -> `verifyMount` (`HostStarted.rootStat` vs host `statSync(root)`) -> `createRunnerProxy` (`src/core/runner-host/proxy.ts`).
     - Before every `run(...)`, calls `checkImageRebuild` (~16 ms `docker image inspect`); if the image ID changed, closes the old host + removes the old managed container, starts fresh on the new image, refreshes `environment()`, and reports recreation/re-key cleanly.
     - Maps typed failures (`unconsented`, `image-missing`, `node-too-old`, `mount-mismatch`, `docker-unreachable`) to unavailable state (`runnerVersion: "unavailable"`, `completedFiles: []`, actionable note) with zero host fallback.
     - Tags failures with container provenance (`in container <target>`) and updates container target status summary (`ready`, `unconsented`, `image-missing`, `node-too-old`, `mount-mismatch`, `docker-unreachable`, keyMode).
     - Cleans up the managed container on `close()` and on idle exit.
   - In `daemon.ts`:
     - Wire container options into `nodeTestRunners` and `pytestRunners`, persist container summary via `writeContainerSummary(store, worktreeId, ...)`, and call `reapOrphanedContainers(worktreeId)` on daemon startup (only when policy declares `containers` and consent allows it, or safely no-oping when Docker is absent!).
4. **`squeal status` and `squeal ps` visibility (`src/core/status/container-status.ts`, `src/core/ps/containers.ts`):**
   - `squeal status`: persist and render a `Containers: ...` line (mirroring `Remote:` in `remote-status.ts`, e.g. `container backend (ready, build-content)` or `container backend (unconsented, build-content)`), plus additive optional `containers?: string` on `StatusSnapshot`.
   - `squeal ps`: list Squeal-labelled managed containers (`org.squeal.managed=true`) via `docker ps -a --filter label=org.squeal.managed=true` (fast, bounded timeout, silently empty if `docker` is absent or daemon unreachable, never starting Docker or failing `squeal ps` on hosts without Docker!), rendered cleanly in both text and `--json` (`containers?: readonly PsContainer[]`).
5. **Tests (including N2 & N3 from review 0.1.643):**
   - `test/runner-host/container/key.test.ts`: prove container keys never collide with host keys, `build-content` matches across two different `imageId`s with identical OS packages + `dockerfileInputs` + env, `build-content` re-keys on a 1-line `dockerfileInputs` change or package change, `image-id` re-keys on `imageId` change even with identical packages/inputs, and slot vars stay out of keys.
   - `test/runner-host/container/runner.test.ts`: test full `createContainerRunner` flow with fake `DockerCli` (consent gate, missing image, node-too-old, mount-mismatch, image rebuild triggering container replacement, close cleanup, zero host fallback).
   - `test/runner-host/container/lifecycle.test.ts`: add N3 same-image config/mount stamp replacement test AND (N2, when Docker + a local Node 22.19+ image is present) real protocol start + cancel/EOF reaping check with zero leftover processes/containers.
   - `test/daemon/container-guard.test.ts`: keep all B1 unconsented/no-host-fallback assertions passing and cover consented routing when container wiring is supplied.
   - `test/status/container-status.test.ts` and `test/ps/containers.test.ts`: verify status rendering, ps managed-container listing (and clean no-op when Docker is absent).
   - Verify: `pnpm exec vitest run test/runner-host/container/key.test.ts test/runner-host/container/runner.test.ts test/runner-host/container/docker-args.test.ts test/runner-host/container/lifecycle.test.ts test/daemon/container-guard.test.ts test/status/container-status.test.ts test/ps/containers.test.ts test/version-sensitive.test.ts test/keys/key-format.test.ts` and `pnpm run lint && pnpm run typecheck`.
