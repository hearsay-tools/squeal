# 020-27: true wording for unwatched files, and no inspector watch without coverage

Use /worker. Shape: repair. Approved by the human on 2026-11-12 ("Build it"). Source: review `reviews/0.1.443-r2.md`, notes S1 and S2; spec 020 D13.4, D19.6.

Outcome: `ci export` counts and names unwatched files apart from files proved to load `node:inspector`, and `ci record` installs the inspector watch only when a coverage provider will run (the project's or Squeal's).

Read: `reviews/0.1.443-r2.md`; spec 020 D19.6; the header comment of `src/runners/vitest/ci-runtime/inspector.cjs`.

Start:
- S1: `src/core/ci/export.ts` (`inspectorFiles`, the `inspector` count near line 182) and `src/cli/ci-export.ts` `leftOut` (about line 214). Lead: split the count into `inspector` (proved loads and `noRecord: "inspector"`) and `unwatched` (`inspector.unknown`), with the text "N test files whose node:inspector use could not be watched (vmThreads pool)". Keep the leave-out rule, exit codes and JSON fields compatible: add a field, do not rename one.
- S2: `src/runners/vitest/ci-runtime/vitest-ci.cjs` line ~257 calls `installWatch(raw, provider)` always. Lead: install only when the settings say a provider runs (Squeal's provider, or the project's coverage enabled); without one, no hook and no `inspector/` log.

Owns: those four files, `src/runners/vitest/ci-coverage.ts` if needed, and their tests (`test/runners/vitest/ci-record-inspector.test.ts`, `test/ci/*export*`). Leave alone: `src/core/code/gate/*` and `src/cli/code-gate*` (row 020-28 runs beside you), `src/core/store/*`.

Done when (tests): a vmThreads part exports nothing and prints the unwatched text, not "loaded"; a mixed part prints both counts; a run with no coverage provider writes no `inspector/` log and exports every file; the existing inspector tests stay green. Lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.
