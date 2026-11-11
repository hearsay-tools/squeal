# Spec 020 wave 6.5: repair of review 0.1.433

## 020-W6 R1: keep only runs whose inputs stayed put; keep state per runner

Use /worker. Shape: repair, on the candidate branch `w6/int`.

Outcome: the two blockers and S1 of `reviews/0.1.433.md` are fixed, each starting from the review's reproduction as a failing test.

Read: `docs/specifications/020-quality-gate/reviews/0.1.433.md` whole ("Inputs for the repair wave" above all); spec D17.3, D11.7; `tasks/020-17c/notes.md`, `tasks/020-17ab/notes.md`.

- **B1** (`src/core/code/gate/keep.ts`): use both outputs of the stability check, `changed` and `touched`, as the daemon's completion barrier does. A file whose keyed inputs either set touches is never kept. Test: an input changed and restored during the run; a steady sibling stays keepable; neither the gate nor a later daemon reads the affected result.
- **B2** (`keep.ts`, `collect.ts` seam): keep expectation and completion state per opened runner (or per test file), never per runner kind. Each completion consumes only its own expectation; every `beginRun` pairs with its own `endRun`. Tests: two node:test projects, both kept, both read back on the second run; and a mixed case where one is found and one runs.
- **S1** (`test/cli/code-gate-parts-cases.test.ts`): each `fresh` control runs on stores of its own, and asserts `fresh.ran`.

Keep the store transactions short and synchronous, the worktree lock, the bounded busy retry, and the lookup order (scope, stored and parts, print, estimate and order, prepare, run, keep). Do not change key meaning, `KEY_FORMAT_VERSION` or `QUALITY_POLICY_VERSION`. Do not run `pnpm run build` or a full suite.

Done when: the reproductions and new tests pass; `test/code/gate/`, `test/cli/code-gate*`, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass; lint and typecheck are clean.
