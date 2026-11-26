# Spec 027 Wave 1 briefs

Disjoint seams run in parallel alongside Spec 028 Wave 0 (`028-02`).

---

## Row 027-02: per-batch slot allocator and project `env` templating

**Outcome:** Every concurrent pytest batch acquires a unique slot (`SQUEAL_SLOT`, `SQUEAL_WORKTREE_SLOT`, and optional `TOX_PARALLEL_ENV`) and expands `{slot}`, `{slot0}`, and `{worktreeSlot}` in `project.env` without changing check keys across slots.

**Spec sections:** `docs/specifications/027-docker-execution/spec.md` D1 and D2; `docs/specifications/027-docker-execution/status.md`.

**Shape:** slice.

**Starting seam:** Add `SlotPool`, `worktreeSlotToken(root)`, and `expandSlotTemplate(value, slot)` in `src/core/runner-host/slots.ts`, add `SlotPolicy` (`slots?: { readonly toxParallelEnv?: boolean; readonly max?: number }`) to `PytestProject` in `src/core/types/policy.ts`, validate `slots` in `src/core/daemon/policy-pytest.ts`, and acquire/release a slot per batch in `src/runners/pytest/run/run.ts` (capping batch concurrency to `slots.max` when set). Keep `src/runners/pytest/environment/hash.ts` hashing the unexpanded `project.env` template strings (never expanded slot values).

**Owned files:**
- `src/core/runner-host/slots.ts` (new)
- `src/core/types/policy.ts`
- `src/core/daemon/policy-pytest.ts`
- `src/runners/pytest/run/run.ts`
- `src/runners/pytest/environment/hash.ts` (only if needed to keep template-string hashing & exclude runtime slot vars cleanly)
- `test/runner-host/slots.test.ts` (new)
- `test/runners/pytest/run/slots.test.ts` (new)
- `test/daemon/policy.test.ts` (if adding `slots` policy validation cases)

**Sibling-owned files to leave alone:** `src/runners/pytest/environment/states.ts`, `src/runners/node-test/**`, `src/runners/js-graph/**`, `src/runners/jest/**`, `src/core/types/policy-jest.ts`, `src/core/daemon/policy-jest.ts`, `docs/board.md`, `plugins/*/dist/**`. Do NOT run `pnpm run build` in your worktree.

**Done when:**
- Unit & integration tests prove: concurrent pytest batches receive distinct `SQUEAL_SLOT` (`1..N`), `SQUEAL_WORKTREE_SLOT`, and `TOX_PARALLEL_ENV` (only when `slots.toxParallelEnv` is true); slots release on normal exit and SIGTERM; `slots.max` caps concurrency; `{slot}`, `{slot0}`, and `{worktreeSlot}` expand while preserving JSON braces (`{"dbname":"workers_{worktreeSlot}"}`); and `environmentHash` is identical across slots.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm exec vitest run test/keys/key-format.test.ts`, and `squeal status --wait 60000 <changed-paths>` pass.
- Work is committed cleanly on your branch with zero untracked files.

Use /worker.

---

## Row 027-03: pytest empty-build-stage editable refinement

**Outcome:** `outsideEditables` in `src/runners/pytest/environment/states.ts` admits build-stage empty editable directories (such as a container's `/pkgs` containing only `pyproject.toml`/`uv.lock`/`.venv` and zero `.py` source files, outside any other git worktree) while continuing to refuse every real outside editable.

**Spec sections:** `docs/specifications/027-docker-execution/spec.md` D3; `docs/specifications/007-pytest-runner/spec.md` D2.

**Shape:** slice.

**Starting seam:** Inspect `outsideEditables` in `src/runners/pytest/environment/states.ts` (lines 109–126) and its tests in `test/runners/pytest/environment/states.test.ts`. Before flagging an outside editable as `editable-outside`, check all three D3 conditions: (1) target directory exists and is not inside another git worktree of this repository (check `.git` ancestry against this repo's common git dir / worktrees), (2) any `.pth` or editable finder file for that distribution under site-packages points only to directories holding zero `.py` source modules (excluding `.venv` / `__pypackages__`), and (3) the editable directory itself holds zero top-level `.py` modules or package directories (`*/__init__.py`) outside `.venv` / `__pypackages__`. Fail closed on any unreadable directory or error.

**Owned files:**
- `src/runners/pytest/environment/states.ts`
- `test/runners/pytest/environment/states.test.ts`

**Sibling-owned files to leave alone:** `src/runners/pytest/environment/hash.ts`, `src/runners/pytest/run/**`, `src/core/types/policy.ts`, `src/core/daemon/policy-pytest.ts`, `src/runners/node-test/**`, `src/runners/js-graph/**`, `src/runners/jest/**`, `docs/board.md`, `plugins/*/dist/**`. Do NOT run `pnpm run build` in your worktree.

**Done when:**
- `test/runners/pytest/environment/states.test.ts` proves: (a) an outside `/pkgs`-style editable with `pyproject.toml`, `uv.lock`, `.venv`, and a `.pth` pointing at `/pkgs` (zero `.py` files) is admitted as `ready`; (b) an outside editable containing a `.py` file or `pkg/__init__.py` is still refused as `editable-outside`; (c) an outside editable inside a sibling git worktree (even empty) is still refused; (d) an in-tree symlink to an outside directory with `.py` files is still refused; (e) an unreadable or missing outside directory is still refused.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm exec vitest run test/keys/key-format.test.ts test/runners/pytest/environment/states.test.ts`, and `squeal status --wait 60000 <changed-paths>` pass.
- Work is committed cleanly on your branch with zero untracked files.

Use /worker.
