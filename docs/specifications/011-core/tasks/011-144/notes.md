# 011-144: focused checks R1, the runner contract: notes

Board row 011-144, R1 of `tasks/011-135/design.md` section 8 (worker b909d1f9, wave 23 W2). A run given texts for a test file runs only the checks whose full name holds one, and reports only those. No scheduler change: no daemon runs a focused tier yet (R2, row 011-145).

## What landed

| Piece | Where | Commit |
| --- | --- | --- |
| `RunOptions.checks` (`FocusedFile[]`), `RunReport.focused` (`FocusedCount[]`), `RunnerAdapter.focuses?: true`; all additive | `src/core/types/runner.ts` | bd39adda6 |
| `holdsCheckText`, `focusedTexts`, `checkTextPattern` | `src/runners/focus.ts` (moved out of `src/core/types/`, see decision 4) | a63ac1a34 |
| Vitest: the specification's `testNamePattern`, the collector's drop of unselected checks, the counts | `src/runners/vitest/{adapter,reporter,run}.ts` | bd39adda6 |
| pytest: `SQUEAL_PYTEST_CHECKS`, the deselection hook, the reader's filter, the module-skip fallback, exit 5 | `src/runners/pytest/{adapter,adapter-run}.ts`, `run/{run,report,events}.ts`, `runtime/squeal_pytest.py` | 133edd163, 64f72f6f1 |
| node:test: written and tested, then reverted (decision 1) | `src/runners/node-test/` | 8991f3bcf, reverted by 42610cc47 |
| Key-format alarm: a focused case per adapter kind | `test/keys/validity/{case.ts,harness/vitest.ts,harness/pytest.ts,harness/reported.ts,cases/adapter/vitest.ts,cases/adapter/pytest.ts,adapters.test.ts}` | 0714473ef, 9cdaa44e6 |

Tests with real runner processes: `test/runners/vitest/focused.test.ts` (Vitest 5.0.3), `test/runners/pytest/focused.test.ts` (pytest through uv, Python 3.13), `test/runners/check-text.test.ts` (the pattern and the rule). Each was checked against a broken implementation: without the Vitest drop, 4 of 5 fail; with a no-op pytest hook, 4 of 6 fail; without the node:test post-filter (before the revert), 1 of 6 failed.

## Decisions the spec did not settle

1. **node:test waits for `adapter:node-test`** (the coordinator, request 78f8b37d, option (b)). The key-format alarm cannot pass any change to node:test's emitted code until row 011-48's node half builds the `adapter:node-test` case kind (`tasks/011-41/notes.md`, decision 5). The node:test change is commit 8991f3bcf: `--test-name-pattern=<checkTextPattern>` before the file in `run/run.ts`, the post-filter on the unsuffixed name in `run/report.ts` (a file error is judged on every reported check, so a check the pattern let through and the filter dropped never makes one), `collected: null`, `focuses: true` in `adapter.ts`, `checks` passed in `adapter-project.ts`, and `test/runners/node-test/focused.test.ts`. After 011-48, cherry-pick it, swap its imports to `src/runners/focus.ts`, and add a focused `adapter:node-test` case as the Vitest and pytest ones are.
2. **The match is on the runner's own full name, without Squeal's duplicate-line suffix (001 D4).** The runners' filters see no suffix, so the post-filter does the same and both agree. A text that holds a suffix (`dup (line 12)`) selects nothing: `matched: 0`. The CLI (R3) could strip a trailing suffix from a text if this matters.
3. **`FocusedCount.collected` is `number | null`.** Vitest counts the module's tests and pytest's plugin counts the file's items before its deselection; node:test hides the checks its pattern leaves out, so it would report `null`. `matched` is the number of checks that hold a text, the ones that ran.
4. **The helpers live in `src/runners/focus.ts`, not `src/core/types/runner.ts`.** The global key-format bundle holds `src/core/types/`'s emitted code, so functions there fired `KEY_FORMAT_VERSION`'s alarm with lines no global case can run. Types erase, so they stay in `runner.ts`.
5. **The validity cases compare the selected checks only** (`selectedOf` in `harness/reported.ts`). The last release ignores `checks` and runs whole files, so both sides' results keep the checks a text selects, by a literal rule written in the harness (the release's tree has no `focus.ts`). The cases pin that a filter changes no outcome or fingerprint it selects; `focused` counts are not compared.
6. **pytest's exit 5.** A batch whose every file has texts and whose texts deselect every item exits 5; it gives no `collected nothing` note, since its counts say so. A batch with a whole file keeps the note.
7. **A pytest module that skips itself.** The static fallback (`skipKnown`) gives a skip for the listed checks that hold a text only. The counts stay pytest's (`collected: 0`), and `skippedFiles` names the file.

## Measured on the way

- **node:test subtests** (Node 22.23.3 and 24.21.0; `probe/`: from that folder, `node --test --test-name-pattern='outer' --test-reporter=./rep.mjs s.test.mjs`, and `a.test.mjs` for suites): Node filters a test before it runs, so a `t.test` subtest is selected only through its parent's name. `outer` runs `outer` and its subtests; `outer > sub` and `sub` select nothing. Safe (`matched: 0`), but a limit for the 003 D5 text. Suites behave as the design says: a suite's name selects its tests, and a pattern that selects nothing reports the file as one passing test, the wrapper, which the reader never takes as a result.
- **Vitest 5 matches `fullTestName`**, the names joined by ` > ` (`node_modules/vitest/dist/task-utils.js`, `interpretTaskModes`), and `createSpecification` makes a new specification each call, so a pattern never outlives its run: the same instance's next run is whole (tested).
- **Observed paths stay safe.** The node:test and pytest adapters' observed stores only add paths, so a focused run can only add what the file really read; it never drops a path a whole run saw. Vitest's `observed` goes to the report, which R2 must not record (C4: a focused tier stores nothing).

## Limits

- **Vitest 4** (below the peer range): a text that cuts a separator in half (`parity >`) holds in a check's name but Vitest 4's space-joined match misses it; Vitest reports that check `skipped`, and the post-filter would keep it as a skip. Vitest 5 has no such case.
- **pytest on Python 3.10** runs the hook only through the validity case (both Pythons); `test/runners/pytest/focused.test.ts` runs 3.13 alone.
- **Older Node versions** below 22 were not probed.

## What R2 (011-145) needs

- **`focuses` does not reach the scheduler yet.** `src/core/daemon/composite-runner.ts` and the runner sets (`runner-set.ts`, `node-test-runners.ts`, `pytest-runners.ts`) pass `RunOptions` whole, so `checks` reaches each adapter, but none of them exposes `focuses`. The composite's run splits files by adapter; R2 decides per file whether its adapter focuses (the composite can answer per file, or the scheduler asks the part).
- `RunReport.focused` holds one entry per completed file given texts, sorted as `completedFiles`. A file whose texts selected nothing is completed with no results and `matched: 0`; a file that failed to load is completed with its file error and `matched: 0`.
- The Vitest report still carries `observed` and `fileDurations` for a focused file; the record path must keep neither (C4).
