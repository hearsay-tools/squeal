# Wave 28: an edit to Squeal's own code re-runs fewer test files that never run it (rows 015-110 to 015-113)

Coordinator 1f84ab15, 2026-11-07. The human approved this repo-local refactor in task 7d611fc4, after row 015-106. No behaviour change; how Squeal keys a user's tests is out of scope. One candidate for 015-110 and 015-111, reviewed by 015-113 before main. Host policy: no local full suite, no `squeal run --all`, no `pnpm run build` in a worker tree. Evidence: `research/edit-reach.md` section 3 and `research/probes/edit-reach/`.

## 015-110: import from the defining module, not a barrel

Use /worker. Shape: slice.

Outcome: no file under `src/` or `test/` imports a barrel (`index.ts` that only re-exports); each import names the module that defines the name, so a test loads only the modules it uses.

Read: `research/edit-reach.md` 2 and 3 (barrels: 41% of pair-seconds, 30% called; `src/core/types/index.ts` `export *` of types-only modules).

Contract (the coordinator's choice):
- Rewrite with a script, kept at `tasks/015-110/rewrite-imports.mjs`, committed alone before its output, so the coordinator can re-run it after 015-111 lands. Hand fixes go in later commits.
- `vi.mock`, `vi.importActual` and `import()` paths follow the module that defines the mocked name. A mock that stops applying silently is the main risk: compare each changed mock's target.
- Delete a barrel no file imports any more. Keep `src/cli/index.ts` (the `squeal` bin entry). A barrel that must stay re-exports types with `export type`.
- Biome forbids new barrels and `export *` (lead: `noBarrelFile`, `noReExportAll` in `biome.json`).

Seam and lead: `src/core/types/index.ts`, then the importers of `src/core/state/index.ts`.

Owns: import statements in `src/**` and `test/**`, the barrels, `biome.json`. Leave alone: `test/scheduler/helpers.ts` and new files of 015-111, `src/core/keys/key-format.ts`, `test/keys/key-format.test.ts` (report its failure, do not re-pin), bundles, `package.json`, the board, `spec.md`, `status.md`.

Done when: `git grep` finds no barrel import (list the command); `squeal status --wait 60000` over the changed tests is current with no failure, or each failure is shown to predate the row; lint and typecheck pass; the final note lists every changed mock and any import cycle the change exposed.

## 015-111: split `test/scheduler/helpers.ts`

Use /worker. Shape: slice.

Outcome: a scheduler test loads only the helpers it uses; a test that names no runner loads neither runner adapter.

Read: `research/edit-reach.md` 3 (506 lines, 23 imports, both runner adapters, 153 test files reach it; 16.4% of pair-seconds hang on its imports).

Contract: shared helpers apart from per-runner ones (Vitest, node:test), plus repo, harness and recording-runner helpers as the code groups them; no re-export file in their place. Import from defining modules (015-110's rule), never a barrel.

Seam and lead: `test/scheduler/helpers.ts` lines 33 to 37 (the runner imports) and `openHarness`.

Owns: `test/scheduler/helpers.ts`, new files beside it, the import lines of the helpers' importers. Leave alone: other import lines, `src/`, `biome.json`, the board, `spec.md`, `status.md`.

Done when: before and after list of how many test files reach each runner adapter through these helpers (static import walk); `squeal status --wait 60000` over the changed tests is current with no failure; lint and typecheck pass.

## 015-112: measure the reach before and after

Use /researcher. Shape: research.

Outcome: `research/edit-reach-refactor.md` gives, for main before wave 28 and for the candidate, pair-seconds and the share of re-run seconds whose test calls the edited file, every source once and by real edits, overall and by path kind (barrel, helper).

Method: reuse `research/probes/edit-reach/` (read only, `/tmp` copies, no test, build or benchmark run). The candidate has no stored closures yet: compute both commits' import part from the static graph the same way, and take only observed, declared and child-process reads from the store. Say where the two methods differ. Coverage "called" for the candidate is carried over per (source, test) pair; state that limit.

Phases: before now, at `origin/main`; after when the coordinator sends the candidate SHA (`worker send --resume`). Owns: that file and `research/probes/edit-reach-refactor/`.

## 015-113: review of the candidate

Use /reviewer. Shape: review. The candidate SHA and range are given at dispatch. Check: (1) behaviour unchanged: each changed `vi.mock` still mocks what it mocked; no new import cycle changes load order; (2) no barrel import or `export *` left, and the Biome rule fails a new one; (3) the helper split leaves no runner adapter in a test that names none; (4) `src/cli/index.ts` and `package.json` `bin` unchanged; (5) version raise and key-format pin, as integrated. No full suite, no `pnpm run build`. Write `reviews/<version>.md` with PASS or FAIL and commit it alone.
