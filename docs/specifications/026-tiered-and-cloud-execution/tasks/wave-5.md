# Spec 026 Wave 5 briefs

Wave 5 closes the final nonblocking review residual from Wave 4 (`026-19`, from `reviews/0.1.620-r2.md` S3) and delivers the end-to-end proof, bounded live Agent37 EU `vm` dogfooding, and `lessons.md` (`026-16`).

Both rows have disjoint file ownership and run in parallel on `claude` `opus` `high`.

---

## Row 026-19: Exact admitted alternate result key for coverage (`0.1.620-r2` S3 residual)

- **Role:** `/worker` (`claude` `opus` `high`)
- **Spec:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D9, D10), `docs/specifications/026-tiered-and-cloud-execution/reviews/0.1.620-r2.md` (S3 residual)
- **File ownership:**
  - `src/core/scheduler/record-tier.ts`
  - `src/core/scheduler/ledger.ts` (only if needed to write/prune the association inside the same store transaction)
  - New helper module under `src/core/scheduler/` (for example `src/core/scheduler/other-machine-keys.ts`)
  - `src/core/code/coverage/runtime.ts`
  - `test/runner-host/remote/remote-key.test.ts` (and new test file under `test/code/coverage/` if helpful)
  - **Do NOT edit:** `src/core/runner-host/remote/*`, `test/e2e/*`, `docs/*`, `package.json`, `plugins/*/dist/*`.

### Problem to solve

In `reviews/0.1.620-r2.md`, `mainStoreResultKey` (`src/core/code/coverage/runtime.ts:70`) resolves an admitted other-machine run's stored key by consulting `readUnknownFiles(store, worktreeId)`. Because `recordUnknownFiles` (`src/core/scheduler/unknown-files.ts:20,83`) caps the diagnostic history at 256 entries, a worktree with >256 files running locally while keyed to a remote evicts the oldest entry and `mainStoreResultKey` returns `undefined`, losing valid coverage for evicted files.

### Requirements

1. Record the exact admitted `(worktreeId, runId, testFile)` to `{ currentKey, storedKey }` association where `storeOtherMachine` (`src/core/scheduler/record-tier.ts`) stores the other-machine result, in store metadata (or a dedicated store-backed helper) completely independent of the 256-entry `unknownFiles` diagnostic cap.
2. Keep the association bounded by live worktree state rather than an arbitrary 256-entry diagnostic cap: overwrite a file's previous association on a newer run, and prune entries whose `currentKey` no longer matches the worktree's current `testFileKeys` (or whose file is no longer in `testFileKeys`).
3. Update `mainStoreResultKey` (`src/core/code/coverage/runtime.ts`) to read this exact association:
   - First keep the fast path: if `store.results.byKey(current, 0)` has a result from `(runId, testFile)`, return `current`.
   - Otherwise look up the recorded association for `(worktreeId, runId, testFile)`.
   - Preserve **re-key / edit protection**: return `undefined` unless the worktree's current key for `testFile` still equals the recorded `currentKey`.
   - Preserve **admission & provenance protection**: verify `store.results.byKey(storedKey, 0)` actually holds a result with `provenance.worktreeId === worktreeId` and `ranFile(r, runId, testFile)` before returning `storedKey`. Never mint a result or make a mismatched current key current.
4. Preserve `CoverageWriter`'s result wait budget (`0`, `250`, `1000`, `5000`, `30000` ms), batching, and store-process relay unchanged.
5. Add a regression test above 256 files (for example 260 files) using the real scheduler, `mainStoreResultKey`, and `CoverageWriter` proving:
   - all 260 files store results under their executed key and remain unknown at their remote key (while `unknownFiles` evicts past 256);
   - `mainStoreResultKey` returns the exact executed key for all 260 files (including evicted file #1);
   - `CoverageWriter` stores coverage under the executed key for evicted and recent files alike, and still rejects coverage once a file is re-keyed.

### Verification

- Do NOT run `pnpm run build` or a local full test suite.
- Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`.
- Verify via Squeal (`squeal status --wait 60000 ...`) and/or explicit `pnpm exec vitest run` on `test/runner-host/remote/remote-key.test.ts`, `test/runner-host/remote/daemon-remote-key.test.ts`, `test/code/coverage/`, and `test/version-sensitive.test.ts`.
- Avoid `process.version` in tests (use `coreEnvironmentInputs(...).nodeVersion`) and avoid any absolute home path.

---

## Row 026-16: End-to-end proof, bounded live Agent37 EU `vm` dogfooding, and `lessons.md`

- **Role:** `/worker` (`claude` `opus` `high`)
- **Spec:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D1–D12, Testing, 026-16), `docs/specifications/026-tiered-and-cloud-execution/status.md`, `docs/process.md` step 7
- **File ownership:**
  - New E2E test files: `test/e2e/spec-026-tiered.test.ts`, `test/e2e/spec-026-remote.test.ts` (plus any helper module under `test/e2e/spec-026-*.ts`)
  - `docs/specifications/026-tiered-and-cloud-execution/lessons.md`
  - **Do NOT edit:** `src/*` (if you discover a real product defect during E2E or live dogfooding, STOP and message the coordinator with the exact reproduction and file/line rather than editing `src/` directly), `docs/board.md`, `docs/specifications/026-tiered-and-cloud-execution/status.md`, `package.json`, `plugins/*/dist/*`.

### Deliverables

#### 1. Automated E2E proof suite (CI-safe: zero external network, zero real `HOME`, zero real `~/.ssh`)

- **`test/e2e/spec-026-tiered.test.ts`** (Track 1 end-to-end with real CLI/daemon processes):
  - Tiered policy (`vitest` at `manual`, `oxlint` at `edit`, `complexity` enabled): start daemon, edit `src/` and `README.md`, prove 0 Vitest runner-host processes start; prove `squeal run unit --base main --wait` runs only the narrow changed/namesake set and names omitted closure files; prove `squeal code --base` reports the 0-groups headline + surfaces stored failures in left-out groups + `--narrow` runs narrow coverage; prove short-lived daemon (`unusedExitMinutes`) exits cleanly when idle and `squeal status` warns honestly after an external edit while down.
- **`test/e2e/spec-026-remote.test.ts`** (Track 2 end-to-end using the built CLI bundle, loopback/local SSH or `remote-container.ts` / fake-ssh transport, real `command` provider shell scripts, and a local mock Agent37 HTTP + proxy + WebSocket server):
  - `command` provider lifecycle end-to-end (`acquire`, `sleep`, `wake`, `release`, plus `squeal remote list|sleep|prune` CLI).
  - Hybrid 2A lanes and runners: `edit`, `slow`, `group`, `background` over a remote machine; `vitest`, `node-test`, and `pytest` (skip `pytest` case only if `pytest` is absent in the environment); remote planning with 0 local runner hosts spawned; remote V8 coverage mapped on remote host and stored in local `code.sqlite` (and read back via `squeal code` / store); `environmentMode: "remote-key"` cross-platform isolation + Linux CI import match; connect-time `dsync` slow-disk warn and refuse.
  - `agent37` provider + `squeal remote-tunnel agent37` against a local mock HTTP + `CONNECT` proxy + WebSocket server proving create, reuse, `git-bundle` bootstrap with `hasGitRepository` (`needsRepository` runs remotely), sleep, wake, and delete on `worktree-removed`.
- Note: `test/e2e/**` is outside default edit-time Squeal checks; run `pnpm exec vitest run test/e2e/spec-026-tiered.test.ts test/e2e/spec-026-remote.test.ts` directly!
- Never reference `process.version` directly (breaks `test/version-sensitive.test.ts`) and never commit absolute home paths (`pnpm run check:private` must pass).

#### 2. Bounded live Agent37 EU `vm` dogfooding proof (run once during this task; NOT in CI tests)

Run a single bounded throwaway script (deleted before commit — do NOT leave scratch scripts or live-network tests in the repo) exercising Squeal's **real `agent37` provider** and **real built `plugins/claude-code/dist/cli/squeal.mjs`** against live Agent37 EU `vm` through this host's `HTTPS_PROXY` (`agent-vault` injects auth headers automatically when `AGENT37_API_KEY` is unset and `HTTPS_PROXY` is set).

**Hard security & cleanup rules:**
- **NEVER** set `NODE_DEBUG=http` or `NODE_DEBUG=*`.
- **NEVER** read, print, log, or write `HTTPS_PROXY`, `AGENT_VAULT_TOKEN`, or any auth header or private key.
- Generate a fresh temporary Ed25519 SSH keypair in a temporary directory, register its public key via `POST https://api.agent37.com/v1/ssh-keys`, and pass its private key path as `sshKeyPath`.
- Wrap the entire run in `try { ... } finally { ... }` that ALWAYS deletes the created Agent37 instance (`DELETE /v1/instances/<id>`) AND deletes the temporary SSH key (`DELETE /v1/ssh-keys/<keyId>`), and cleans up the local temp dir.
- Record `GET https://api.agent37.com/v1/billing` before and after (budget: well under `$0.10`).
- After cleanup, call `GET https://api.agent37.com/v1/instances` and `GET https://api.agent37.com/v1/ssh-keys` and verify BOTH return `{"data":[]}` (0 instances, 0 SSH keys remaining).

**What the live EU `vm` proof must verify and measure:**
1. Real `agent37` provider `acquire`: EU `vm` creation time, Node check/install time, `git-bundle` bootstrap time over `squeal remote-tunnel agent37`, and connect-time `dsync` health check result (median ms/sync).
2. Real Hybrid 2A remote execution on a small git Vitest fixture: remote planning (0 local runner hosts), remote Vitest run with `coverage: "remote"` storing mapped `CoverageRecord`s in local `code.sqlite`, and a `needsRepository` Git test running remotely under `hasGitRepository: true`.
3. Real `sleep()` -> verify instance enters `sleeping` -> real `wake()` -> verify second edit/run passes (record sleep time, wake time, and post-wake edit-to-verdict latency).
4. Real `release("worktree-removed")` -> verify instance is deleted on Agent37.

#### 3. Write `docs/specifications/026-tiered-and-cloud-execution/lessons.md`

- Write in plain technical English, matching the repo's `lessons.md` style (check `docs/specifications/024-antigravity-adapter/lessons.md` or `docs/specifications/021-remote-store-and-execution/lessons.md` for conventions).
- Summarize what shipped across Waves 1–4 (`0.1.616`, `0.1.617`, `0.1.619`, `0.1.620`), automated E2E proof results, live Agent37 EU `vm` dogfooding measurements (latencies, `dsync` ms, USD spend, 0-instance/0-key cleanup proof), and any defects found.
- Close out every open question/risk from `spec.md` with evidence, and clearly note what remains unverified (for example native macOS host dogfooding).

### Verification

- Do NOT run `pnpm run build` or a local full test suite.
- Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`, `pnpm exec vitest run test/e2e/spec-026-tiered.test.ts test/e2e/spec-026-remote.test.ts test/version-sensitive.test.ts`.
