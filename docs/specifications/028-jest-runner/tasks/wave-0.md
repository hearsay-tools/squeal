# Spec 028 Wave 0 brief

Runs in parallel with Spec 027 Wave 1 (`027-02`, `027-03`).

---

## Row 028-02: shared `js-graph`, `JestProject` policy loader, Jest 29/30 resolver, and Jest fixtures

**Outcome:** Extract `src/runners/node-test/graph/` into shared `src/runners/js-graph/` without breaking runner boundaries or key validity, add `JestProject` policy types & validator, implement pnpm-safe Jest 29/30 resolution with Jest 29 `TS_NODE_PROJECT` hygiene, and add minimal Jest 29 & 30 test fixtures.

**Spec sections:** `docs/specifications/028-jest-runner/spec.md` D1, D2, D6; `docs/specifications/028-jest-runner/research/jest-runner.md` F1.4, F5.3.

**Shape:** slice (Wave 0 scaffold).

**Starting seam:**
1. Move/extract `src/runners/node-test/graph/*` to `src/runners/js-graph/` and keep thin re-exports in `src/runners/node-test/graph/` (or update `src/runners/node-test/` imports) so `test/runners/boundaries.test.ts` AND `test/keys/key-format.test.ts` stay 100% green without raising `KEY_FORMAT_VERSION`! (Check `test/keys/validity/entries/node-test.ts` carefully: do not change key-relevant behavior or error strings.)
2. Create `src/core/types/policy-jest.ts` (`JestProject`, `JestProjectFile`) and `src/core/daemon/policy-jest.ts` (`jestProjects()` using `projectEntries` from `policy-node-test.ts`). Do NOT edit `src/core/types/policy.ts` or `src/core/daemon/policy.ts` in this row (owned by `027-02`; Wave 2 wires `Policy.jest`).
3. Create `src/runners/jest/resolve.ts` (DO NOT create `src/runners/jest/adapter.ts` yet, because `test/runners/boundaries.test.ts` requires a kit pack as soon as `adapter.ts` exists): pnpm-safe resolution `jest -> jest-cli -> @jest/core, jest-config, jest-runtime`, version gate `>= 29.0.0 < 31.0.0`, and Jest 29 `TS_NODE_PROJECT` lookup staying strictly inside the worktree root.
4. Add minimal Jest fixture source under `test/fixtures/jest/` (no `node_modules` committed; follow `test/helpers/` pattern for installing or resolving Jest 29/30 in `$TMPDIR` or check if `jest` should stay out of root `package.json` and be installed into a cached temp dir by a test helper, noting any `package.json` untouched).

**Owned files:**
- `src/runners/js-graph/**` (new)
- `src/runners/node-test/graph/**` (re-exports / import updates only)
- `src/core/types/policy-jest.ts` (new)
- `src/core/daemon/policy-jest.ts` (new)
- `src/runners/jest/resolve.ts` (new; NO `adapter.ts`)
- `test/fixtures/jest/**` (new, no `node_modules`)
- `test/daemon/policy-jest.test.ts` (new)
- `test/runners/jest/resolve.test.ts` (new)

**Sibling-owned files to leave alone:** `src/core/types/policy.ts`, `src/core/daemon/policy.ts`, `src/core/daemon/policy-pytest.ts`, `src/core/runner-host/slots.ts`, `src/runners/pytest/**`, `docs/board.md`, `plugins/*/dist/**`, `package.json`, `pnpm-lock.yaml`. Do NOT run `pnpm run build` in your worktree.

**Done when:**
- `test/runners/boundaries.test.ts`, `test/harness/shared/names-no-runner.test.ts`, `test/keys/key-format.test.ts`, `test/daemon/policy-jest.test.ts`, `test/runners/jest/resolve.test.ts`, and existing `test/runners/node-test/` graph tests pass.
- `pnpm run lint`, `pnpm run typecheck`, and `squeal status --wait 60000 <changed-paths>` pass.
- Work is committed cleanly on your branch with zero untracked files.

Use /worker.
