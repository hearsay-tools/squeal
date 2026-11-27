# 028 Jest runner: Wave 5 brief (row 028-08)

Final proof wave for Spec 028 (`docs/specifications/028-jest-runner/spec.md`, Testing & D8):
1. Automated end-to-end test suite (`test/e2e/spec-028-jest.test.ts`) exercising the real `squeal` CLI and daemon on BOTH Jest 29.7.0 and Jest 30.5.2.
2. Live dogfooding on a throwaway copy of `~/projects/saas-boilerplate` covering all 17 Jest projects (202 test files), cross-package edits (`webapp-core` -> `webapp`), `ts-jest` `.d.ts` re-keying, and clean `squeal stop`, recorded in `docs/specifications/028-jest-runner/lessons.md`.

### Read first

- `docs/specifications/028-jest-runner/spec.md` (Goals, D1 to D8, Testing)
- `docs/specifications/028-jest-runner/research/jest-runner.md` (F1 to F5)
- `docs/specifications/027-docker-execution/lessons.md` (format & hygiene reference)
- `test/e2e/spec-027-docker.test.ts` (E2E harness patterns for launching real built `squeal` CLI/daemon)
- `test/helpers/jest-env.ts` (reusing `/tmp/squeal-jest-29-*` and `/tmp/squeal-jest-30-*` caches via `TMPDIR=/tmp`)

### File ownership (strict)

- `test/e2e/spec-028-jest.test.ts` (new)
- `docs/specifications/028-jest-runner/lessons.md` (new)

Do not edit any product files under `src/` or `plugins/`. If live dogfooding uncovers a real Squeal product bug, document it clearly as a finding in `lessons.md` AND message the coordinator immediately (`hsq message progress`) with exact reproduction details so we can decide whether to fix it before moving Spec 028 to `shipped`.

### Hard safety and privacy rules

1. **NEVER modify `~/projects/saas-boilerplate`:**
   - Record `git -C ~/projects/saas-boilerplate rev-parse HEAD` and `git -C ~/projects/saas-boilerplate status --short` BEFORE starting and AFTER finishing, and record the exact comparison in `lessons.md`.
   - Copy it ONLY via `git -C ~/projects/saas-boilerplate archive HEAD` into a fresh scratch directory under `$TMPDIR/dogfood-028/sb`, initialize a local git repo there, and run all experiments inside that throwaway copy.
   - Run the daemon with isolated `HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`, and `XDG_STATE_HOME` under `$TMPDIR/dogfood-028/` so real user config/state is never touched.
   - Delete `$TMPDIR/dogfood-028` completely before finishing and verify zero leftover `squeal`, `warm-worker`, or `jest` processes from the dogfood run.
2. **Private material check (`SQUEAL_PRIVATE_DENYLIST`):**
   - NEVER write any organization prefix before `saas-boilerplate` (write `saas-boilerplate` alone, NEVER `<org>/saas-boilerplate`!).
   - NEVER write absolute home paths (write `~/projects/saas-boilerplate` or `$TMPDIR/...`, never `/home/...`).
   - Avoid em-dashes in `lessons.md`; use plain ASCII punctuation.
3. **Never mutate `/tmp/squeal-jest-29-*` or `/tmp/squeal-jest-30-*`** (pass `TMPDIR=/tmp` when running Vitest on `test/e2e/spec-028-jest.test.ts` so those strict-layout caches are reused).
4. **Never run `pnpm run build` or a full local test suite.** Use the already-built `plugins/claude-code/dist/cli/squeal.mjs` (version `0.1.651`) in this worktree for the live dogfooding run!

---

### Part 1: Automated E2E suite (`test/e2e/spec-028-jest.test.ts`)

Write a clean, deterministic E2E test suite running against the real `squeal` CLI (`plugins/claude-code/dist/cli/squeal.mjs` or the same launcher `test/e2e/spec-027-docker.test.ts` uses) on BOTH Jest 29.7.0 and Jest 30.5.2 (`JEST_MAJORS`, linking `node_modules/jest` from `installJest(major)`):

1. **Setup discovery + multi-project monorepo (`squeal setup --yes --no-warmup`):**
   - Create a temp git repo with an empty root `jest.config.mjs` (`export default {}`) above two package projects (`packages/core` and `packages/app`, where `packages/app`'s test imports a helper from `packages/core`), plus a second unaffected test file in `packages/app`.
   - Run `squeal setup --yes --no-warmup` -> assert `squeal.config.json` seeds BOTH package projects and skips the empty root catch-all.
2. **Full baseline validation + warm cross-package affected-only edits:**
   - Start daemon / run foreground `squeal run --all --wait` -> assert all tests pass and `squeal status` reports green/current.
   - Edit `packages/core/src/helper.js` to break `packages/app`'s importing test (and `packages/core`'s test) -> run `squeal status --wait 60000 packages/core/src/helper.js` -> assert `FAIL` on the affected tests while the unaffected test stays current without failing.
   - Revert `packages/core/src/helper.js` -> run `squeal status --wait 60000 packages/core/src/helper.js` -> assert `PASS` recovery.
3. **Opt-in plain-Jest `denyWhenCurrent` & Nx fallthrough:**
   - With `testCommand.denyWhenCurrent: true` in `squeal.config.json`, exercise the hook / pre-tool-use path (matching how other E2E tests test `denyWhenCurrent`, e.g. `test/e2e/claude-code.test.ts` or hook CLI invocation):
     - Plain `jest <file>` in the package directory is denied with Squeal's current-results reason.
     - `jest <file> | tail` and `pnpm nx run app:test` fall through (allowed).
4. **Clean `squeal stop`:**
   - Run `squeal stop` and verify the daemon and all warm Jest worker child processes exit cleanly (zero leftover PIDs in the worktree's run).

Keep the E2E suite fast (under ~45 s total for both majors) and resilient to host load (use foreground `squeal run --all --wait` / `squeal status --wait` rather than waiting on background backlog under load, as in `test/e2e/spec-027-docker.test.ts`).

---

### Part 2: Live dogfooding on throwaway copy of `~/projects/saas-boilerplate` (`docs/specifications/028-jest-runner/lessons.md`)

Run against a `git archive HEAD` copy of `~/projects/saas-boilerplate` under `$TMPDIR/dogfood-028/sb` (with `pnpm install --frozen-lockfile` run ONCE inside the throwaway copy):

1. **Setup discovery:**
   - Run `squeal setup --yes --no-warmup` inside `$TMPDIR/dogfood-028/sb`.
   - Record exact seeded `jest` projects in `squeal.config.json` (confirm all 17 package configs discovered, empty root `jest.config.ts` skipped with note).
2. **Baseline run across all 17 projects (202 test files):**
   - Start daemon with `squeal start` and run `squeal run --all --wait` (or measure per-project / full suite with explicit timing and RAM/worker counts).
   - Record exact totals: projects, test files discovered/run, passing/failing/skipped/unknown tests, wall time, warm worker behavior, and any pre-existing failures vs Squeal issues.
   - Note: if all 202 files take a long time or if a specific package has pre-existing env requirements (e.g. missing `.env`), record the EXACT observed result honestly (never hide or fake any number!).
3. **Cross-package warm edit (`webapp-core` -> `webapp`):**
   - Pick a component/helper in `packages/webapp-libs/webapp-core` imported by tests in BOTH `webapp-core` and `webapp` (for example `button.component.tsx` or a simple util).
   - Introduce a small deliberate edit, wait with `squeal status --wait <edited-path>`, record exact files selected across BOTH `webapp-core` and `webapp` (and any other importing packages), exact wall time, and verify unaffected packages stayed current!
   - Revert the edit, wait with `squeal status --wait <edited-path>`, verify recovery back to green, and record wall time.
4. **`ts-jest` `.d.ts` edit re-keying:**
   - In a `ts-jest` package (for example `packages/internal/tools`), verify a `.d.ts` type-declaration edit re-keys and re-runs the affected `ts-jest` test (producing a TypeScript error on a breaking change and recovering on revert). Record exact commands, file paths, and timings.
5. **Clean shutdown & cleanup:**
   - Run `squeal stop`, measure wall time, verify zero leftover processes.
   - Remove `$TMPDIR/dogfood-028` completely.
   - Re-check `git -C ~/projects/saas-boilerplate rev-parse HEAD` and `git -C ~/projects/saas-boilerplate status --short` and record proof in `lessons.md` that `~/projects/saas-boilerplate` is untouched.
6. **Write `docs/specifications/028-jest-runner/lessons.md`:**
   - Follow the clear, measured style of `docs/specifications/027-docker-execution/lessons.md`: Setup, Measured runs (table with exact commands, results, wall times), Findings (F1..Fn), Safety and cleanup, and Open questions closed.

### Verification

Run:
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run check:private origin/main`
- `TMPDIR=/tmp pnpm exec vitest run test/e2e/spec-028-jest.test.ts`
- `git diff --check`

Commit cleanly on your worker branch and report exact commands, test results, and key dogfooding numbers.
