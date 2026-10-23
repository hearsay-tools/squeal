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

## R1: review of cand/0.1.270

Use /reviewer. Shape: review. Pinned to `cand/0.1.270` at 4d511f858ead6f97477f943aaed9fffe706b12d5; the range is `origin/main..4d511f858`: W2's two commits (011-79, worker a3badb38), W3's four (011-111, worker 5cccc4dd), W1's six (011-78, worker d7e21eb0), one docs commit (011 C6, C9, C10 and `status.md`) and the release commit (0.1.270, bundles).

Read `tasks/wave-17.md` (W1 to W3), the notes under `tasks/011-78/`, `tasks/011-79/` and `tasks/011-111/`, board rows 011-78, 011-79 and 011-111, `tasks/011-62/design.md` sections 2 to 4, the amended C6, C9 and C10 sentences, and the three new `status.md` lines. Check that:
- 011-78: R1's tests 1 to 7 hold through a real daemon; a removed project's files, keys, known states, queued work and retries go, and its told failure is delivered once as resolved; a run in flight of a removed project is stopped and stores nothing; an unparsable file forgets nothing; judge the generic set in `runner-set.ts`, the reconcile at every `invalidate`, and withholding a leaver's part not yet started;
- 011-79: a deleted file's and a removed project's failures are marked, a keyed or listed-but-unkeyed one's not; `--all-worktrees` judges each row in its own worktree; the cap and the total are unchanged; one lookup per listed row;
- 011-111: `start` prints its status only once the store records the daemon that answered, for a handoff and for a spawn; at the bound a daemon that answered is still printed, and none answering exits 1 as before; the stand-in test fails without the fix; `warmup.test.ts` and `lifecycle.test.ts` still pass;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is 0.1.270 in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then the test files W1 to W3 added or changed, directly. The full suite is CI on the candidate and the coordinator's locked gate (`.ai/cezar/t/04a258b0/logs/gate-w17.log`); a gate log names only failing files. R1 test 8, the probe `tasks/011-62/probes/run.sh` against the bundle, is the coordinator's: its log is `.ai/cezar/t/04a258b0/logs/probe-011-78.log`. Row 006-95 is a known flake. Write `reviews/0.1.270.md` with a PASS or FAIL verdict and commit it alone.
