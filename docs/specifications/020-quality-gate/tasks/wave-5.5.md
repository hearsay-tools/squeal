# Spec 020 wave 5.5: repair of review 0.1.432

## 020-W5 R1: cancel `prepare` with the gate; print only setups that will run

Use /worker. Shape: repair, on the candidate branch `w5/int`.

Outcome: the two blockers of `reviews/0.1.432.md` are fixed, each with the review's reproduction as a failing test first.

Read: `docs/specifications/020-quality-gate/reviews/0.1.432.md` whole (B1, B2, "Inputs for the repair"); spec D3.4, D14.4, D15.3, D11.7, D13.2.

- **B1** (`src/core/code/gate/prepare.ts`, `src/cli/code-gate-relaunch.ts`): the collection process owns the active `prepare` process group. On SIGINT or SIGTERM it terminates the group, within the existing close grace, before it settles or exits. Listeners are removed when the command settles. The empty-stdout and exit-3 behavior without a whole report stays. Regression through the real CLI entry, with `--json` and without: cancel during `prepare`; the `prepare` PID and an ordinary descendant are gone, and no write happens after the CLI exits.
- **B2** (`src/core/code/gate/collect.ts`, `src/core/code/gate/prerun.ts`): resolve stored and parts evidence before the pre-run print. The print keeps selection and run counts apart, and names only the setups of projects with files that reach `adapter.run`; the root's only when a Vitest run remains. The print still comes before any setup or `prepare`. Cases: all from stores, all from parts, and mixed projects where a project served only from stores is not named.

Do not change evaluator rules, function selection, key meaning or `QUALITY_POLICY_VERSION`. Do not run `pnpm run build` or a full suite.

Done when: both reproductions pass as tests; `test/code/gate/`, `test/cli/code-gate*`, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass; lint and typecheck are clean; `squeal status --wait 60000 <changed paths>` shows only bundle drift.
