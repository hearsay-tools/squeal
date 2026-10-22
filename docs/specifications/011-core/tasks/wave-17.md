# Wave 17 of spec 011

Three rows the coordinator chose on 2026-10-23 under the human's standing instruction ("If you are done with it before morning - grab the next piece yourself", 2026-10-22), from main with 0.1.269. W1 and W2 are R1 and R2 of `tasks/011-62/design.md` section 4.2 (gh-53). W3 is the start-handoff flake, which failed candidate CI on 2026-10-22. Their files are disjoint, so they run in parallel. W1 owns `src/core/daemon/daemon.ts`: W3 asks W1's owner, the coordinator, before it edits it.

## W1: 011-78, a configuration reload reconciles the node:test and pytest projects

Use /worker. Shape: slice.

Outcome: a `squeal.config.json` change that removes, adds, renames or changes a node:test or pytest project takes effect at that revision, with no restart.

Read board row 011-78; `tasks/011-62/design.md` sections 1 to 4 (R1); spec 011 C10, *Projects at a reload*; `tasks/011-62/probes/`.

Seam: `createCompositeRunner` (`src/core/daemon/composite-runner.ts:28`) reads its members at each call, and the daemon's wiring at `daemon.ts:452` and `:552`. A lead: R1's first edit, a member getter that returns one entry fewer and a unit test that `testFiles()` omits that project and `recreatedProjects` names it.

Owns: `composite-runner.ts`, `node-test-runners.ts`, `pytest-runners.ts`, `daemon.ts` (the wiring and `#reloadPolicy`, `:374`), `config-file.ts`, `policy.ts`, `LoadedPolicy` in `src/core/types/policy.ts`, their tests, notes under `tasks/011-78/`. Not yours: `src/core/scheduler/` (ask if a test needs it), `src/runners/`, `src/core/status/` (W2), `src/cli/` (W3), the board, spec text, bundles, version. No `npm run build`.

Done when: R1's tests 1 to 7 and 9 pass; test 8's probe is left to the coordinator's candidate; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 011-79, `failures` marks history outside the active configuration

Use /worker. Shape: slice.

Outcome: `squeal failures` marks a failure whose file is no longer a test file in its worktree, `not a test file here now` in text and `active: false` in `--json`.

Read board row 011-79; `tasks/011-62/design.md` sections 2.6 and 4.2 (R2); spec 011 C6 on `squeal failures` (row 011-64) and C10, *Projects at a reload*.

Seam: `readFailures` and `formatFailures` (`src/core/status/failures.ts:101`, `:161`). A lead: one `test_file_keys` lookup for each listed row, in the row's own worktree.

Owns: `src/core/status/failures.ts`, the failures payload type, their tests, notes under `tasks/011-79/`. Not yours: the store's results repository, `src/core/daemon/` (W1), `src/cli/` (W3), the board, spec text, bundles, version. No `npm run build`.

Done when: R2's done-when holds (a deleted file's and a removed project's failures are marked, a keyed one's not; `--all-worktrees` judges each row in its own worktree; `--json` carries `active`; the 20-row cap and the total are unchanged); lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W3: 011-111, the start-handoff test passes beside a full suite

Use /worker. Shape: repair.

Outcome: `test/daemon/start-handoff.test.ts` "exits 0 once the successor serves, and never says alive" passes 20 of 20 runs beside a full suite. The fix names which of the row's two leads it closes.

Read board row 011-111 (its two leads, and `busy-edit.test.ts`); `tasks/011-110/notes.md` "For the next row"; spec 011 C9 on a handoff (row 011-34); candidate CI 39864834794, job Node 22 (3/3), whose status text read `0.1.269 serves once the old daemon's lock frees`.

Seam: `finishHandoff` (`src/cli/start.ts:127`) and the test's `stoppingWithItsTier` (`test/daemon/start-handoff.test.ts:102`). A lead: when does `start` print its status, against when the successor first reports that it validates?

Owns: `src/cli/start.ts`, `test/daemon/start-handoff.test.ts`, `test/daemon/busy-edit.test.ts`, their helpers, notes under `tasks/011-111/`. Not yours: `src/core/daemon/` (W1: ask first; a product cause there is a C9 edit for the coordinator), `src/core/status/` (W2), the board, spec text, bundles, version. No `npm run build`.

Done when: the test passes 20 of 20 single-file runs while one full suite runs beside them (the full suite under `flock /run/user/$(id -u)/squeal-full-run.lock`, the loop outside it); it failed beside a suite before the fix, or the notes say why that could not be shown; the notes name the lead and the evidence; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.
