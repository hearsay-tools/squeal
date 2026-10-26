# Wave 46

From main after 0.1.332 (`d76c3ac9b`), 2026-10-26. Five rows on disjoint seams: one research row on a selection that may miss readers (W1), one product fix (W2) and three test-only rows (W3 to W5). Host load is about 13 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite. Gh-99 waits for the human and is not in this wave.

## W1: 011-233, a source path's selection named other test files at each revision

Use /researcher. Row 011-233; `tasks/011-219/notes.md`, "Squeal's selection".

Outcome: the cause of the unstable selection is named with evidence, and whether a named wait on a source path can pass while a reader that fails is never selected.

Seam: `selectNamedFiles` (`src/cli/named-selection.ts:75`) uses a stored closure only when it is valid for the test file's current key (005 D2). A lead to test first: an edit to a source file changes the key of every test file that reads it, so the stored closures of exactly those readers are invalid until their closures resolve again; the selection then names whichever readers have resolved. Build a fixture store (no live store, socket or permit pool); read the 011-25 edit cut and the `lookup-only` default.

Owns `docs/specifications/011-core/research/source-path-selection.md` and probes under `research/probes/source-path-selection/`. No product or test edits.

Done when the findings file and its probes are committed and answer the row's three questions with numbers.

## W2: 011-232, a signalled pytest file is never completed

Use /worker. Shape: slice. Row 011-232; `tasks/011-230/notes.md`, "The other runners" and "For whoever continues".

Outcome: a pytest file that Squeal signalled, at a stop or at the deadline, is never completed, even when the project's own SIGTERM handler lets pytest write the last teardown.

Seam: `stopAll` (`src/runners/pytest/run/run.ts:158`). First edit, offered as a lead: set the mark where every run passes, as 011-230 did (`src/runners/node-test/run/run.ts:173`), per batch, so no validity case is changed; run `test/keys/key-format.test.ts` before you commit.

Owns `src/runners/pytest/run/` and a new test beside `test/runners/pytest/run/`. Not yours: `src/runners/node-test/`, `src/runners/vitest/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when a fake Python that writes a teardown after SIGTERM gives a file that is not completed, for a stop and for the deadline; the test fails without the fix; the key-format test passes with no version moved.

## W3: 011-221, the scheduler's model test covers slow lanes and holds

Use /worker. Shape: slice. Row 011-221; `tasks/011-211/notes.md`.

Outcome: the model test runs slow-lane files and hold events, and invariant G fails when a slow lane stays open under a hold or after 60 s with no slow tier.

Seam: `test/scheduler/model-fixture.ts` (events, about line 60 to 120). First edit, offered as a lead: a slow-lane file kind and a hold event in the generator, then invariant G in `model-scheduler.test.ts`.

Owns `test/scheduler/model-fixture.ts`, `model-clock.ts` and `model-scheduler.test.ts`. Not yours: `src/`, other test files, the board, spec text. A product defect the model finds is a request to the coordinator, not an edit.

Done when the model test passes with its earlier invariants, and a deliberate break of 011-211's close path (reverted before commit) makes G fail; paste both runs.

## W4: 011-229, tests reach the two uncovered error paths of the full integrity check

Use /worker. Shape: slice. Row 011-229.

Outcome: a test reaches each of the two paths that no in-process test reaches.

Seam: `FullCheckOwner`'s constructor `catch` (`src/core/daemon/full-check.ts:188`) and the child's `error` handler (`full-check.ts:83`). Start from `test/daemon/full-check.test.ts` and `full-check-helpers.ts`.

Owns `test/daemon/full-check*.test.ts` and `full-check-helpers.ts`. `src/core/daemon/full-check.ts` only after a request to the coordinator, if a path cannot be reached without a seam. Not yours: other `src/` files, the board, spec text.

Done when a throwing start is logged and the daemon keeps serving, and a spawn error gives the claim back and a later start claims.

## W5: 011-222, the validity harness drops its pre-move entries

Use /worker. Shape: slice. Row 011-222; `docs/specifications/015-coverage-complexity/research/validity-harness-uncovered.md` Q4.

Outcome: the harness's entries for trees that predate a move are gone, with the compare result unchanged.

Seam: `BEFORE_MOVES` and `ENTRIES_BEFORE_MOVES` (`test/keys/validity/bundle.ts:67` and `:96`). First step: check that `compare-refs.ts` from the oldest tag it still compares needs none of them.

Owns `test/keys/validity/`. Not yours: `src/`, other tests, the board, spec text.

Done when `env -u PLUGIN_ROOT -u PLUGIN_DATA node --import tsx test/keys/validity/compare-refs.ts squeal--v0.1.332 HEAD` gives the same result before and after (paste both), and `test/keys/` passes.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. When Squeal's selection does not name a test file you changed or that imports your change through a helper (row 011-233), run that file directly and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits.
