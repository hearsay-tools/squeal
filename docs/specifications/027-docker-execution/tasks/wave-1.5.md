# Spec 027 Wave 1.5 — Repair review 0.1.642 blockers B1 and B2

Candidate `a4d9de9c6` (`0.1.642`) received verdict **FAIL** in `docs/specifications/027-docker-execution/reviews/0.1.642.md` with two proven blockers (B1 on row `027-03`, B2 on row `027-02`) and zero findings on `028-02`.

This repair wave runs two disjoint workers in parallel, then re-gates and runs a narrow re-review (`reviews/0.1.642-r2.md`).

Hard rules for both workers:
- Read `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/027-docker-execution/spec.md`, and `docs/specifications/027-docker-execution/reviews/0.1.642.md`.
- Stay strictly inside your file ownership below.
- Do not run `pnpm run build` or touch `package.json`, `install.sh`, `plugins/`, or `docs/board.md`.
- Do not bump `PYTEST_ADAPTER_VERSION` or `KEY_FORMAT_VERSION`.
- Verify every changed line under `src/` is exercised by `pnpm exec vitest run test/keys/key-format.test.ts` locally (zero uncovered lines, zero differing outputs against the last release), in addition to your unit/integration tests, `pnpm run lint`, and `pnpm run typecheck`.
- Never run a full test suite.

---

## Repair B1 (row 027-03): revalidate outside-editable admission

**Review finding:** B1 (P1) in `docs/specifications/027-docker-execution/reviews/0.1.642.md`.

**Problem:** Once an empty outside build-stage editable is admitted (`buildStageEmpty` in `src/runners/pytest/environment/states.ts`), its directory contents and setuptools finder `.py` bytes are absent from `EnvironmentFiles` and `environmentFingerprint`. Consequently:
- `adapter.recheck()` (`src/runners/pytest/adapter.ts:245`) takes its unchanged-fingerprint shortcut and returns `{ recreatedProjects: [] }`, retaining `ready` with the same environment key even after `.py` code appears in the build-stage directory or a formerly empty finder `.py` maps a module.
- `runProject()` (`src/runners/pytest/adapter-run.ts:53,72`) only checks `currentFingerprint(environment)` before and after `runPytest`, so an environment that stops meeting D3 before or during a run does not withhold results.

**File ownership:**
- `src/runners/pytest/adapter.ts`
- `src/runners/pytest/adapter-run.ts`
- `src/runners/pytest/environment/states.ts` (only if needed; do not touch `environment/hash.ts` or `environment/fingerprint.ts` unless strictly needed, and never touch `slots.ts` or `run/run.ts`)
- `test/runners/pytest/adapter-editable.test.ts` (new focused test file) or existing `test/runners/pytest/adapter*.test.ts`
- `test/keys/validity/cases/adapter/pytest-editable.ts` (only if needed for key-format coverage)

**Requirements:**
1. Make the D3 outside-editable admission condition (`outsideEditables(root, environment.discovery.env).length === 0`) part of revalidation everywhere a ready environment's stability is checked:
   - during admission settle (`admit()` in `adapter.ts`),
   - on quiet `recheck()` (`adapter.ts`), and
   - before and after execution in `runProject()` (`adapter-run.ts`).
2. When an admitted outside editable directory (or a directory added by its `.pth`) gains Python code or stops satisfying D3, or when a formerly empty setuptools finder `.py` changes its `MAPPING`/`NAMESPACES`:
   - `recheck()` must invalidate admission, recreate the project (`recreatedProjects: [project.name]`), and transition `environment()` to `editable-outside` (`runnerVersion: "unavailable"`).
   - `runProject()` must detect the violation before or after `runPytest`, return `{ kind: "moved", report: unavailable(...) }`, set `stale = true`, and withhold results (`completedFiles: []`, `results: []`).
3. Keep empty-stage admission and existing worktree-independent environment keys intact (`environmentHash` must not change).
4. Keep every changed line in `src/` covered by `test/keys/key-format.test.ts` without bumping `PYTEST_ADAPTER_VERSION`. (Be careful with untaken multi-line branches: remember every validity case must produce equal output to the last release, so avoid dead/uncovered branch lines that only execute when an outside editable transitions from admitted to refused.)
5. Add focused adapter-level tests covering all three required cases from review B1:
   - source `.py` appearing in an admitted empty build-stage dir after admission (`recheck()` returns `recreatedProjects: [project.name]` and `environment()` transitions to refused/`editable-outside`),
   - source `.py` appearing during an in-flight `adapter.run(...)` (run withholds results and subsequent `environment()`/`recheck()` refuses),
   - a formerly empty setuptools finder `.py` changing its `MAPPING`/`NAMESPACES` after admission (`recheck()` recreates and refuses).

**Verification:**
- `pnpm exec vitest run test/runners/pytest/environment/states.test.ts test/runners/pytest/adapter-editable.test.ts test/keys/key-format.test.ts`
- `pnpm run lint && pnpm run typecheck`

---

## Repair B2 (row 027-02): expand slot templates in PATH and PYTHONPATH

**Review finding:** B2 (P2) in `docs/specifications/027-docker-execution/reviews/0.1.642.md`.

**Problem:** `expandedVariables(env, project.env, slot)` in `src/core/runner-host/slots.ts:135` only expands `templates[name]` when `env[name] === template`. Because `runEnvironment()` (`src/runners/pytest/environment/hash.ts:55`) already prefixed `<env>/bin` onto `PATH` and `runPytest()` (`src/runners/pytest/run/run.ts:113`) already appended `runtimeDir` onto `PYTHONPATH`, both variables fail the equality check and keep literal `{slot}` / `{slot0}` / `{worktreeSlot}`.

**File ownership:**
- `src/core/runner-host/slots.ts`
- `src/runners/pytest/run/run.ts`
- `test/runner-host/slots.test.ts`
- `test/runners/pytest/run/slots.test.ts`
- `test/keys/validity/cases/adapter/pytest-slots.ts`

**Requirements:**
1. Expand effective `project.env` slot templates for each acquired slot BEFORE activation (`<env>/bin` prefix on `PATH`, `VIRTUAL_ENV`) and BEFORE `runtimeDir` is appended onto `PYTHONPATH`.
2. Preserve explicit `options.childEnv` precedence over `project.env` for all variables (ordinary variables, `PATH`, and `PYTHONPATH`, with `runtimeDir` still appended to `PYTHONPATH` so `squeal_pytest` loads).
3. Keep `environmentHash` and `environment.runEnv` reading the unexpanded `project.env` templates so every slot shares one environment key.
4. Keep ordinary JSON braces literal, keep slot values out of keys, and retain process-group slot release and cancellation.
5. Keep `src/core/runner-host/slots.ts` clean and reusable for upcoming runners (e.g., Jest and container host). Check `src/runners/pytest/run/command.ts` (read-only) to confirm nothing in `pytestArgs` leaks unexpanded `PATH`/`PYTHONPATH`.
6. Keep every changed line in `src/` covered by `test/keys/key-format.test.ts` without bumping `PYTEST_ADAPTER_VERSION` (extend `test/keys/validity/cases/adapter/pytest-slots.ts` if needed so all changed lines run).
7. Add subprocess assertions in `test/runners/pytest/run/slots.test.ts` using real `runEnvironment` + `runPytest` proving:
   - `project.env` with `PATH` and `PYTHONPATH` containing `{slot}` (or `{worktreeSlot}`/`{slot0}`) expands both while retaining `<env>/bin` first on `PATH` and `runtimeDir` on `PYTHONPATH`,
   - explicit `childEnv` overrides `project.env` (covering ordinary vars, `PATH`, and `PYTHONPATH` with `runtimeDir` retained).
8. Update `test/runner-host/slots.test.ts` for any refined helper in `src/core/runner-host/slots.ts`.

**Verification:**
- `pnpm exec vitest run test/runner-host/slots.test.ts test/runners/pytest/run/slots.test.ts test/keys/key-format.test.ts`
- `pnpm run lint && pnpm run typecheck`
