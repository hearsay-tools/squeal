# Research brief: function-selection (row 022-07)

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `../status.md` and the rules for findings documents in `README.md` (this folder) first. Those rules apply here.

The human, 2026-11-21: "We tried to narrow the test selection with what modules are loaded. Have we ever considered checking functions are actually executed?", then "Do you see a way to achieve this level of savings safely?", then "Run that research".

"This level of savings" is `../../015-coverage-complexity/research/edit-reach.md` section 3: of this repository's re-run seconds, 23.7% are in test files that called a function of the edited file, 41.4% loaded it and called none, 32.5% did not load it.

Earlier research to extend, not repeat, all under `../../015-coverage-complexity/research/`: `line-level-selection.md` (old-line selection: 21% of pairs with no hit, 3 left after fallbacks, 8 of 9 fixture failures missed), `selection-tools.md` (function bodies plus a module skeleton, as pytest-testmon does; its JS prototype and probes), `cezar-selection.md` (51 files against 51 on ten cezar commits), `edit-reach.md`. In this folder: `loaded-modules.md`. Reuse their probes where they fit. Spec 011 non-goal "Per-test closures from runtime coverage" and 022's non-goal on function level selection stand; this research decides nothing.

Write `research/function-selection.md`, probes under `research/probes/function-selection/`. Touch nothing else. Do not design the feature.

## The two candidates to measure

**Rule A, a narrow skip.** A test file keeps its result after an edit when all of these hold:

1. It has a coverage record made at its key before the edit.
2. Every path changed since that record changed only inside bodies of functions the record shows the test never entered.
3. The rest of each changed module is the same: signatures, top-level statements, imports, exports, class shapes.
4. Each new file parses.
5. The test started no child process or worker, and did not read a changed file as data (Squeal's observed reads).

Every other case falls back to today's selection.

**Rule B, order without a skip.** The edit cut (`src/core/scheduler/edit-cut.ts`, `011-core/research/edit-cut.md`) picks the test files that run at once; the rest wait for catch-up. Rule B picks, from the coverage records, the test files that entered a changed function. No test file gets a result without a run.

## Questions

1. **Rule A savings on real edits.** Replay the stored edit revisions of this repository and of cezar (store copies; old and new file contents from git objects where they exist). Report the funnel: all (revision, re-keyed test file) pairs and their recorded seconds, then what each of conditions 1 to 5 removes, in that order, then what is left. Give the result per single edit revision and per commit, and say how many pairs could not be judged (no old blob, no record) and why. Compare with the 21% and 15% of `line-level-selection.md` and say what the function-body comparison adds over its line-count fallback.
2. **Rule A misses on fixtures.** Run rule A against the ten fixtures of `line-level-selection.md` and the cases of `selection-tools.md`. Add fixtures for: `Function.prototype.toString` on a function never called; a stack trace or line number assertion on code below an edit that adds lines; a getter, a decorator, a default parameter and a class field initializer; an edit inside a nested function or arrow when only the outer one ran. For each: does rule A skip, and does the result change.
3. **How often the gaps occur in real tests.** For this repository's and cezar's test files: (a) reflection on function text; can the in-worker coverage provider (`src/core/code/coverage/provider.mjs`) see a `toString` call on a project function, and at what cost; (b) assertions on line numbers or stack text, including snapshots; (c) a test file whose entered-function set differs between two runs at one key. Say where a count is a text scan with false positives.
4. **Record carry-over.** A test file that rule A skips gets no new record at its new key. Can the old record stand for the next edit, and what must be compared so that a chain of skipped edits stays sound? State the argument and its assumptions; tag it `inferred` unless a fixture shows it.
5. **Rule B.** On the recorded new failures in edit revisions of both stores: was the failing test file in the set rule B runs at once, and in the set today's cut runs at once? Report the size of each set in files and recorded seconds, the failures each set holds, and the files with no usable record.
6. **Cost.** The time to compute function bodies and the skeleton for one changed file and to compare them, on this repository's sources, with the one-minute load beside it. The share of test files with a usable pre-edit record at edit time.

## Limits

- No test suite, no `squeal run --all`, no product, configuration or live-store change. Store copies with `VACUUM INTO` through a read-only connection into `$TMPDIR`.
- Fixtures run in `$TMPDIR`, each direct Vitest run with a timeout; before you finish, check that no process you started is left.
- Recommendation: one clause first. State effect sizes before any p value, and the n. Keep fixture counts apart from real-history counts.
