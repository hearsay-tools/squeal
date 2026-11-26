# Spec 027 Wave 4: End-to-end proof, `saas-boilerplate` dogfooding, and N1/N2 follow-ups (Row `027-07`)

Spec: `docs/specifications/027-docker-execution/spec.md` (D8, Testing).
Prior reviews: `docs/specifications/027-docker-execution/reviews/0.1.644.md` (N1, N2), `0.1.644-r4.md` (PASS).
Reference repository on this host: `~/projects/saas-boilerplate` (read-only! NEVER modify anything in `~/projects/saas-boilerplate`).

Do **not** run `pnpm run build` in your worker worktree (the coordinator rebuilds all five plugin bundles at integration). Do **not** run a full local test suite or set timers waiting on Squeal background backlogs.

## Ownership
- `src/core/status/container-status.ts`
- `src/core/daemon/daemon.ts`
- `src/core/runner-host/container/runner.ts`
- `test/status/container-status.test.ts`
- `test/runner-host/container/runner.test.ts`
- `test/e2e/spec-027-docker.test.ts` (new)
- `docs/specifications/027-docker-execution/lessons.md` (new)

## Requirements

1. **Review 0.1.644 N1: Clear retired container status entries on policy reload:**
   - In `src/core/status/container-status.ts`, add a `reconcile(active: readonly { runner: string; project: string; target?: string }[])` (or `prune`) method on `containerSummaries()` that removes entries no longer present in active configured projects (or whose target changed), returning the new summary string when changed (including `""` when the last container project is removed so `writeContainerSummary(store, worktreeId, "")` deletes the meta row!).
   - In `src/core/daemon/daemon.ts`, call `summaries.reconcile(...)` whenever policy reloads (reconciling active `nodeTest`, `pytest`, and `jest` container projects) and persist the updated text (clearing the row when empty).
   - Add unit + live-reconcile tests in `test/status/container-status.test.ts`: removing the last container project clears `Containers:` completely, and moving a project from target `a` to target `b` removes stale `a` from the summary.

2. **Review 0.1.644 N2: Explicit container provenance on ordinary failing checks (D7.3):**
   - Inspect how ordinary failed tests (`report.failure === null` with failed `CheckResult` entries in `report.results`) render in `squeal status` and `squeal why` (check `src/core/runner-host/container/runner.ts` and how `remote` / `RunReport` records provenance without breaking check identity or error fingerprint semantics!).
   - Make sure ordinary assertion failures in a managed container preserve check identity and error fingerprint while surfacing `in container <target>` (for example via `report.failure` or an additive display/provenance field or note: verify what `squeal status` and `squeal why` display on an ordinary failing check, keeping `CheckResult.name` and fingerprint untouched!).
   - Add a regression test in `test/runner-host/container/runner.test.ts` exercising one ordinary assertion failure through the managed route and verifying check identity, error fingerprint stability, and container target provenance.

3. **Automated E2E suite (`test/e2e/spec-027-docker.test.ts`):**
   - Test the full Spec 027 user workflow through Squeal's real built/CLI and daemon paths (gated cleanly on Docker availability; never `docker pull`, never `docker build` inside Squeal product code):
     - Stage 1 (always runs, no Docker required): concurrent pytest/node:test batches with `slots.max`, `SQUEAL_SLOT` / `SQUEAL_WORKTREE_SLOT` / `TOX_PARALLEL_ENV`, `{slot}`/`{slot0}`/`{worktreeSlot}` env templating (including JSON braces), identical keys across slots, and empty-build-stage editable admission vs real outside editable refusal.
     - Stage 2 (consent + container guard + container key space + status/ps): unconsented project runs zero `docker` commands and reports actionable `unconsented` note; `build-content` vs `image-id` key isolation and CI export/import reuse; `squeal ps` lists Squeal-labelled managed containers cleanly; `squeal status` shows `Containers:` and clears it when removed.
     - Real Docker checks (gated on `docker info` + local image, skipping cleanly if no local Node 22.19+ image exists; never pulling inside the test): mount proof, Node 22.19+ refusal on Node-less local image, orphan reaping, zero root-owned files in worktree.

4. **Live dogfooding on a throwaway copy of `~/projects/saas-boilerplate` + `lessons.md`:**
   - **CRITICAL SAFETY RULES:**
     - **NEVER modify `~/projects/saas-boilerplate`!** Verify `git -C ~/projects/saas-boilerplate status --short` is identical before and after.
     - Copy `~/projects/saas-boilerplate` into a fresh scratch directory under `$TMPDIR` (`mktemp -d`), work ONLY inside that throwaway copy, and use an isolated Compose project name (`COMPOSE_PROJECT_NAME=squeal-dogfood-$$`) and non-default host ports if binding any ports.
     - **Before finishing, stop and remove EVERY container, image tag (only any throwaway test image you built), network, volume, and scratch directory you created**, verifying `docker ps -a --filter label=com.docker.compose.project=squeal-dogfood-...` and `docker ps -a --filter label=org.squeal.managed=true` have zero leftovers!
   - What to dogfood on the throwaway copy of `saas-boilerplate`:
     1. Inspect `packages/backend` (62 pytest files) and `packages/workers` (1 pytest file / 2 tests) and their Dockerfiles / `docker-compose.yml`.
     2. Build a throwaway overlay image (e.g. `squeal-dogfood-backend:local`) ONLY in the scratch copy that adds Node 22.19+ on top of the repo's backend image (or verify whether the local backend image is already built or cheap to build; if building `saas-boilerplate` backend takes >3 minutes or needs unavailable credentials/network, document that honestly and test with a lightweight Python+pytest+Node 22.19+ image matching `saas-boilerplate`'s `/pkgs` editable + Postgres/Redis/stripemock topology: do NOT get stuck for 20 minutes on a giant image build!).
     3. Prove end-to-end with Squeal's real container runner-host (`docker exec -i` + `bundleRootFor` + `--user <uid>:<gid>` + `PYTHONPYCACHEPREFIX` + `dev:inode` mount proof + `slots` + `build-content` keying):
        - Running `saas-boilerplate` backend / workers pytest tests in the managed container (including parallel slots against Postgres/Redis/stripemock without DB/rate-limit collisions).
        - Editing a Python file and observing incremental affected re-run + cache hit on unchanged files.
        - Running `squeal ci record` / `squeal ci export` (or verifying `build-content` key match across two separate builds) and confirming cross-worktree/CI reuse.
        - Checking `squeal status` and `squeal ps` output, verifying zero root-owned files in the throwaway worktree, and verifying clean container teardown on stop.
   - Write `docs/specifications/027-docker-execution/lessons.md` (no em-dashes, no absolute home paths: write `~`!):
     - Summarize every measured command, timing, pass count, and concrete finding.
     - Explicitly answer Open Question 2 in `spec.md` (whether user-local `networkOverride`/`composeProject` in `~/.config/squeal/containers.json` is sufficient vs reading `COMPOSE_PROJECT_NAME` from `.env`) with evidence from the dogfooding run.
     - Confirm `~/projects/saas-boilerplate` was untouched and zero dogfood containers/volumes/files remain.

## Verification
1. Run `pnpm run lint && pnpm run typecheck`.
2. Run `pnpm exec vitest run test/status/container-status.test.ts test/runner-host/container/runner.test.ts test/e2e/spec-027-docker.test.ts` and local `pnpm exec vitest run test/keys/key-format.test.ts`.
3. Run `pnpm run check:private origin/main` to verify `lessons.md` and tests contain zero absolute home paths or private material.
4. Commit cleanly and report commit SHAs and exact verification output.
