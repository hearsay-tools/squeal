# Spec 026 Wave 8 brief (approved bugfix row 026-22)

Approved by the human on 2026-11-24 after live Agent37 rollout on `squeal` and `squawk` under Node v26.13.0 hit `pnpm install --frozen-lockfile failed on the remote (exit code 127): sh: 1: pnpm: not found`.

---

## Row 026-22: Auto-provision missing `pnpm`/`yarn` on remote machines without `corepack`

- **Role:** `/worker` (`claude` `opus` `high`)
- **Spec:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D7.3.3, D8), `src/core/runner-host/remote/tree-install.ts`, `src/core/runner-host/remote/providers/agent37/bootstrap.ts`
- **Shape:** slice
- **File ownership:**
  - `src/core/runner-host/remote/tree-install.ts` (and new helper `src/core/runner-host/remote/package-manager.ts`)
  - `src/core/runner-host/remote/providers/agent37/bootstrap.ts`
  - `test/runner-host/remote/package-manager.test.ts` and `test/runner-host/remote/providers/agent37-node.test.ts`
  - **Do NOT edit:** `docs/board.md`, `status.md`, `package.json`, `plugins/*/dist/*`, `src/core/scheduler/*`, `src/core/code/gate/*`, `src/cli/code-gate*`.

### Problem

1. Node 25/26+ no longer bundles `corepack`. `agent37/bootstrap.ts` symlinked `$D/bin/corepack` unconditionally (creating a dangling link) and ran `"$D/bin/corepack" enable ... || true`, silently failing on Node 26.
2. `tree-install.ts` ran `pnpm install --frozen-lockfile` / `yarn install ...` directly over non-login SSH without ensuring `dirname(process.execPath)` is on `PATH` or provisioning a missing `pnpm`/`yarn` binary.

### Requirements

1. In `tree-install.ts` / `package-manager.ts`:
   - Keep any `pnpm`/`yarn` already on `env.PATH` untouched (zero `npm` calls; preserves `countedPnpm` in `tree-install.test.ts`).
   - Append `dirname(process.execPath)` to `PATH` so `node`/`npm` beside the remote Node binary are always reachable.
   - When the install command needs `pnpm` or `yarn` and it is missing from `PATH`, read `packageManager` from `package.json`, drop any `+hash` suffix, validate strict `x.y.z[-pre]` (falling back to `<name>@latest` on invalid/injected values; Yarn 2+ uses `@yarnpkg/cli-dist`), install once into `<cache>/squeal/trees/pm/<name>-<version>` via `npm install --no-audit --no-fund --prefix <part> <spec>` with atomic rename, and reuse the cached binary on subsequent installs.
2. In `agent37/bootstrap.ts`:
   - Symlink `node`, `npm`, `npx`, `corepack` only when `[ -x "$D/bin/$b" ]`; remove any earlier dangling link; run `corepack enable` only when `[ -x "$D/bin/corepack" ]`.
3. Tests proving existing `pnpm` on `PATH` makes 0 `npm` calls, missing `pnpm`/`yarn` installs exact validated version and reuses cache (including concurrent installs and injection rejection), and `bootstrap.ts` leaves no dangling `corepack` symlink when absent.
