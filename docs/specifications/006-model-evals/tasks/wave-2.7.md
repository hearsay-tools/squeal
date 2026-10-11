# 006 wave 2.7: third and last repair of the scoring slice, `reviews/wave-2.6.md`

Bought by the human on 2026-10-11, after the second failing review. One worker and one narrow review: the round ends at the review's verdict.

## 006-19 repair: pushed provenance, effective selection, failure identity, the red step

Use /worker. Shape: repair. Read `../reviews/wave-2.6.md` first, then `../spec.md` D4 as amended 2026-10-11 (the `no-rerun-answered` and `own-run-uncovered` rows). Every reproduction in the review becomes a failing test before its fix, in both harnesses, beside its positive counterpart. No subject sessions. Never run or import `evals/bin/run-baseline.mjs`. Never run `npm run build` in your worktree. Never commit a credential or a private URL.

- **B2** (`evals/lib/evidence.mjs`): a pushed FAIL or PASS block keeps its own observed revision and validity. A block saying the result came from an older run, or that the current revision is pending, is not current evidence for its file. Match a run's selector to test files with the runner's selection rule, the same one coverage uses: `vitest run test/money` answers like `test/money.test.ts`, while a glob that also selects an unanswered file does not count as answered.
- **B3** (`evals/lib/commands.mjs`, `evals/lib/evidence.mjs`): the scope keeps `--exclude`, name filters and node's `--test-skip-pattern`. Failing closed, a run covers no affected path it excludes, name-filters or skip-filters, and a summary of only skipped tests is not a completed run. A full or targeted unfiltered run of the affected tests counts, failing or passing. Pin the four Vitest controls and the node:test skip-pattern control from the review, with its real output as fixtures.
- **S2:** track failures by check identity and transition kind. `FAIL -> FAIL, failure changed` leaves the count unchanged, and a recovery removes that same failure once. Add the product-formatted changed-then-recovered positive, and a still-failing negative.
- **S1:** `tasks.json` names the Sunday check for T2's red step. The retained evidence keeps enough check identity that a calendar-flake failure alone is not the red step.
- **Retained timeline:** add the fields these need, and regrade the committed results with a new expectations revision.

**Owns:** `evals/lib/{commands,evidence,grade,behaviours,results}.mjs`, `evals/bin/regrade.mjs`, `evals/tasks/tasks.json`, `evals/results/**`, `evals/README.md`, `test/evals/reference-sessions.ts`, `test/evals/reference.test.ts`, and new test files under `test/evals/` named `wave27-*`. Add export lines to `evals/lib/index.mjs` and `index.d.mts` additively.

**Done when:** every reproduction in `../reviews/wave-2.6.md` and its positive is a test in both harnesses; the earlier evals tests pass; the regrade is committed; the repository gate is green.

## 006-20 narrow review of wave 2.7

Use /reviewer. Range `0730b6a6^..c43062d9`, 006-19's four commits on main. Limited to B2, B3, S1 and S2 of `../reviews/wave-2.6.md`, by the human's decision. Re-run each reproduction and positive, then the nearest variants:
- B2: a delivery with a stale entry, a recovery at an older revision, a `-t` selector against a delivered file;
- B3: `--exclude` with an overlapping include, a `-t` matching every test, `--project`, a node:test `--test-name-pattern`;
- S2: two different failing checks in one file, a changed failure then a different failure.

New findings count only in the changed lines. Synthetic probes only, no real subject sessions. Check in a scratch copy created at the reviewed SHA, never by building in your worktree. Never run or import `evals/bin/run-baseline.mjs`. Findings go to `../reviews/wave-2.7.md`.
