# Spec 026 Wave 7 brief (approved quality row 026-21 / 026-q3)

Approved by the human on 2026-11-24: unify `squeal code --narrow` (`src/core/code/gate/narrow.ts`) and `squeal run --base` (`src/core/scheduler/edit-cut.ts`, `editWork`) on one shared pure selection rule so both select the exact same test files for a diff (Spec 026 D5.2).

---

## Row 026-21 (from `026-q3`): Unify `code --narrow` and `run --base` selection (`editWork`)

- **Role:** `/worker` (`claude` `opus` `high`)
- **Spec:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D4, D5.2), `src/core/scheduler/edit-cut.ts` (`editWork`), `src/core/code/gate/narrow.ts` (`narrowRun`)
- **File ownership:**
  - `src/core/scheduler/edit-cut.ts` (extract pure narrow-selection function, or create a small shared pure helper module imported by both `edit-cut.ts` and `narrow.ts`)
  - `src/core/code/gate/narrow.ts` (and `src/core/code/gate/` callers only if wiring `observedDirect` / `durations` / transitive reads into `narrowRun`)
  - `test/code/gate/narrow.test.ts` (and scheduler `edit-cut` tests if adding parity tests)
  - **Do NOT edit:** `docs/board.md`, `docs/specifications/026-tiered-and-cloud-execution/status.md`, `package.json`, `plugins/*/dist/*`.

### Problem to solve

From the Spec 026 `/quality` scan (`8880743e`):
- `src/core/code/gate/narrow.ts:40-70` keeps its own copy of 019 D6's narrow selection rule instead of sharing `editWork`'s rule in `src/core/scheduler/edit-cut.ts:103-136`.
- The two copies diverge:
  1. `narrow.ts` counts only direct importers against `runner.tierSize`, whereas `editWork` ranks direct importers first and then files that read the changed path indirectly (transitive importers / observed reads beyond declared inputs) up to `runner.tierSize`.
  2. `narrow.ts` ignores `observedDirect` (stored direct marks from 016 D4) when available from the store.
- As a result, `squeal code --base <ref> --narrow` and `squeal run <group> --base <ref>` can select different test files for the same diff, contradicting Spec 026 D5.2.

### Requirements

1. Extract the pure narrow-selection algorithm from `editWork` (`src/core/scheduler/edit-cut.ts`) into one shared pure function (taking changed paths, namesakes, direct importers, `observedDirect`, transitive/indirect readers, `tierSize`, duration lookup, and `within` predicate) and call it from **both** `editWork` (`edit-cut.ts`) and `narrowRun` (`narrow.ts`).
2. Keep `editWork`'s existing scheduler behavior byte-for-byte identical (every existing `edit-cut` / `run-group-base` / `run-group-narrow` test passes unchanged).
3. Update `narrowRun` (and its gate caller where the store is available) so `squeal code --base <ref> --narrow`:
   - selects the exact same set as `editWork` / `squeal run <group> --base <ref>` (including indirect/transitive readers up to `tierSize` after direct importers, and `observedDirect` when store evidence is present),
   - still keeps explicitly passed `--test` files,
   - removes the duplicated selection logic (~30–40 lines saved).
4. Update `test/code/gate/narrow.test.ts` and add a parity regression proving `narrowRun` and `editWork` pick the exact same kept/dropped set on a diff with namesakes, direct importers, transitive readers, and `observedDirect` under `runner.tierSize`.

### Verification

- Do NOT run `pnpm run build` or a local full test suite.
- Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`.
- Verify via Squeal (`squeal status --wait 60000 ...`) and explicit `pnpm exec vitest run` on:
  - `test/code/gate/narrow.test.ts`
  - `test/code/gate/` (affected gate tests)
  - `test/scheduler/` (`edit-cut` tests)
  - `test/cli/run-group-base.test.ts`
  - `test/e2e/spec-026-tiered.test.ts`
  - `test/version-sensitive.test.ts`
