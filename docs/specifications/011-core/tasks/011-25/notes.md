# 011-25: worker notes (brief W3 of `tasks/wave-6.md`)

Worker 56c669b1, 2026-10-20. Base: main at eff7ae33 (this brief's commit). 011-38 has not landed on main, so no rebase. Cut (n+K) as C4 step 4 states it after the 2026-10-20 amendment: a revision of fewer than 10 keyed paths keeps as an edit's work its added and edited test files, each changed source's namesakes among the files it re-keyed (or, for a source with none, the runner's direct importers of it), and the `runner.tierSize` shortest other direct importers by last-known duration. Everything else it re-keys is catch-up.

## Seams

- **The matcher**, `src/core/scheduler/namesakes.ts` `namesakesOf(source, testFilePaths)`: one pure function, no state, so row 011-43 can make its patterns a project's own.
- **The runner part**, `refinement.ts` `fetchRunnerPart`: after the closures, `fetchEditCut` (`edit-cut.ts`) maps each changed source to its namesakes' ids. It marks a source **bare** when the revision's reach holds none of them. The reach is the runner's `direct` and `transitive` plus the reverse index of the stored closures. It returns the bare sources' direct importers. `affected` answers for its paths together, so when some sources are bare and others are not, the runner is asked once more, for the bare sources only. That call runs last, so an abandoned one costs no closure. With no answer, every direct importer of the revision stands for theirs. `RunnerPart.cut` is absent when `affected` gave no answer or the content part found the revision catch-up.
- **The apply**, `applyRunnerPart`: `ledger.settle` runs as before. Then `editWork` computes the kept ids against `Ledger.recentOf(changed, direct)`, the same reach `settle` uses. `demote` calls `Queue.toCatchUp(ref, keyedAt)` for every reached or content-part-recent file the cut does not keep. `toCatchUp` drops only this revision's reason (`Entry.recentBy`), so a file another revision's edit made recent stays in the first group, and a promotion keeps it there. `ledger.ts` is not touched (011-38's file). The settle is not split, and no `SettleOptions` field is added.
- **The start**, `bootstrap.ts` `baseline`: for each unrefined revision below the threshold that reaches a miss, `cutAtStart` asks `affected` for its paths under the baseline's bound, then applies the same cut. The baseline's `priorityOf` now gets the runner's direct ids. No call is made under `lookup-only` or when the revision reached nothing that runs.

## Tests

| File | Done-when (`research/edit-cut.md`) | Red on main |
|---|---|---|
| `test/scheduler/namesakes.test.ts` | 2 (the matchers) | module absent |
| `test/scheduler/edit-cut.test.ts` | 1, 3 (no namesake, a namesake not re-keyed, two `e.test.ts`, `index.ts`, a bare source beside a named one), 4, 7 (affected fails, the bare call abandoned) | 7 of 8 (7's "affected fails" is a guard and passes on main) |
| `test/scheduler/edit-cut-route.test.ts` | 5 (guard), 6 (Vitest cancel; node:test beside slots), 8 (declared input and importers beyond 4, promoted by a named wait), 9 (a start, and `lookup-only`) | 5 of 6 with main's `refinement.ts` and `bootstrap.ts`; 9 `lookup-only` passes on main. Case 5's guard itself holds on main, where no catch-up tier exists. The test also requires a catch-up tier, so it is red there |
| `catch-up.test.ts`, `catch-up-classification.test.ts` | 10 | green |

Done-when 11 (the cezar replay) is skipped: optional in the brief, and the host's load stayed at 25 to 70 on 24 CPUs. The research's replay of (n+4) stands as the expectation: p90 next-edit wait 8 s on cezar's central revisions.

**Test durations.** Done-when 1 names 6 other direct importers of 0.1 to 3 s. Here the two beyond the four shortest take 5 and 6 s (`FOUR_SHORT`). Below that, they could share an edit tier with a kept file as tier mates (next section), so the test could not tell "kept" from "fills a place". The 200 transitive files keep 0.1 to 5 s and one of 60 s. `expectCut` asserts three things: every kept file runs in an ungranted tier, every ungranted tier leads with a kept file, and the files that cannot be tier mates run with a grant.

## Decisions the spec did not settle

1. **Tier mates.** An edit's tier still fills its free places with files of comparable time from the groups after it, catch-up included (`selectTier`, `joinSpan`, task 001-184). That is unchanged, so done-when 1's "edit tiers hold a.test.ts and the 4 shortest" holds as "lead with", and up to `tierSize - 1` short catch-up files may ride along. The wave-5 B1 test already sets `tierSize` 1 to avoid them.
2. **A source** is a changed path that is no test file and that a stored closure holds. A path no closure holds has no importers to keep. A declared input held through a closure counts. A non-code one (`.json`, `.md`, `.snap`) has no namesake, so its direct importers are kept (a `.snap`'s owner is direct).
3. **The K shortest** are taken among all the revision's other direct importers, lookup hits included. Unknown durations go last, ties by id.
4. **Namesake definition, against the research's probe** (`probes/edit-cut/lib.mjs`), following the spec text:
   - the three conventional places (directory, `__tests__`, the mirror below `src/`) are one set, not "the first matcher that finds any";
   - the anywhere match is taken only when it is the only one, for pytest too. The probe's strict "pytest anywhere" matcher took several;
   - the mirror accepts any prefix before the first `src/` segment (`packages/p/src/x.ts` to `packages/p/test/x.test.ts`), and not `lib/`;
   - a file in `__tests__` needs no `.test` mark (Jest's convention); anywhere else it does;
   - a script source matches only script tests, a Python one only pytest names.
5. **The catch-up fixture's runner** (`catch-up-fixture.ts`) answered `affected` with nothing. A real runner names a one-hop importer direct. Under the cut, a fake that names nothing makes every reached file catch-up, so the fixture now splits by `imports` (direct) and a new `through` (transitive). The wave-5 B1 test's fake now adds the real split to its own direct importer. `claims-fixture.ts` and `wall-fixture.ts` still answer nothing. Their closures hold only the test file itself, so their edits are edited test files and stay edits.

## Namesake cases the research did not cover (for 011-43)

- node:test's unmarked layout, `lib/foo.js` with `test/foo.js` (its default `**/test/**/*.js`), and the `foo-test.js`, `foo_test.js`, `test-foo.js` names: no namesake today, so the source keeps its direct importers.
- A `lib/` tree mirrored to `test/`.
- Python `__init__.py`, the index of a package: it has no special case, and `test___init__.py` is unlikely.
- Two pytest files of a stem in different trees (`tests/unit/test_d.py`, `tests/integration/test_d.py`): none, so the source keeps its direct importers.
- A sibling and a mirror both present: both are kept. The probe would have kept the sibling only.
- Component sources (`.vue`, `.svelte`): no namesake.
- A test of another script extension (`x.cjs` with `x.test.ts`): matched.

## Type changes (all additive)

- `RunnerPart.cut?: EditCut` (`refinement.ts`).
- New exports in `src/core/scheduler/`: `namesakesOf` (`namesakes.ts`); `EditCut`, `fetchEditCut`, `editWork`, `demote`, `cutAtStart` (`edit-cut.ts`).
- Test fixtures: `CatchUpFile.through?`, `CatchUpOptions.runnerPartMs?`, `catchUpRepo(files, others = [])`.

## Interplay with siblings

- **011-33** (`wip/011-33`) rewrote the same `baseline` block, the `unseen` loop and the misses' enqueue, so the two conflict textually. To merge, keep 011-33's structure (the loop runs under every policy, `handed` seeds the sets) and put this row's loop body inside it. Under `lookup-only` the `missed` set must then be the files 011-33 enqueues (`handed.pending`), so the runner is asked only for a revision that reaches handed-over work.
- **011-38**: none of its files changed. The cut reads `Ledger.recentOf`, `ledger.files` and `ledger.queue`, and writes only through `toCatchUp`.

## Release

The scheduler sources are guarded, so this row raises the key format. As the brief says, there is no version bump and no re-pin. Expected failures until the coordinators bundle it: `test/keys/key-format.test.ts` (3 tests) and the 4 bundle-drift tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`).

## Verification

On `5d8d030e`, rebased onto main `e34c7b62` (whose new commits change docs only). `npm run lint` and `npm run typecheck` are clean. `squeal run --all --wait` (Squeal 0.1.226) completed checkpoint `9c8d6e0c` at revision 32 and exited 1: 740 test files current, 7,033 checks passed, 7 skipped, 9 known failures. Seven of the failures are the expected ones above. The other two are row 001-431's recorder-fidelity tests (`observe-fidelity.test.ts:119`, `run-reads-fidelity.test.ts:116`), which fail under Squeal's daemon on main too. Load was 12 to 84 on 24 CPUs during the session.
