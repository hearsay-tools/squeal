# Wave 56.5: repair of review 0.1.379 (row 011-262)

Coordinator cbd3888a, 2026-10-30. Review `reviews/0.1.379.md` FAIL on cand/0.1.379 `f6b681f2c`. Host policy as wave 56. Not yours: the board, spec text, `status.md`, bundles (`plugins/*/dist`), versions. No `pnpm run build`.

## R1: B1, S1 and S2 (worker 408523d6, resumed)

Use /worker. Shape: repair.

Outcome: a `git-ignored` mark is true when the revision is recorded; agents' reading instructions and both news parsers match the new line.

Read: the review (B1, S1, S2, "Inputs for the fix wave").

B1 seam: `isExtra` in `src/core/scheduler/keying.ts`, used by `reconcileBatch` (`batch.ts`) and `WorktreeKeys.reconcile`. Decide the ignored fact for the changed extra paths before `commitBatch`, by one batched check per revision that changes an extra path (`git check-ignore` is already used per batch in `candidates.ts`), never per delivery; a path git no longer ignores leaves the mark off, and should leave `#extra` if that is how tracked files are handled. Send me the shape first if it needs a store, type or key change.

S1: the four `skills/squeal/references/reports.md` copies and the reading-header paragraph in the four `SKILL.md` copies (find their single source if one exists): news names the changed paths and the `git-ignored` mark.

S2: `evals/lib/squeal-text.mjs` NEWS and `test/e2e/agree.ts` read a path containing `)`, e.g. `src/app/(auth)/page.tsx`, with and without a commit; keep agree.ts capture indexes.

Done when: same-daemon force-add-and-commit and ignore-rule-removal tests show revision 1 marked, revision 2 not, and a header spanning both unmarked; both writers covered; S2 round-trips real formatter output; affected named tests, lint, typecheck pass; notes section added.
