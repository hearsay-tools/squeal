# Wave 16 of spec 011

The last two rows of `tasks/011-61/design.md` (section 4), R2 and R3, from main with 0.1.268; 0.1.266 shipped R1 (row 011-72). The human chose the wave on 2026-10-22 ("Wave 16: 011-73 + 011-74"). The design gives them disjoint files, so they run in parallel. 3b94ca98's rows (`tasks/toolkit-latency.md`) own `edit-cut.ts`, `refinement.ts`, `checkpoints.ts`, `ledger.ts`, `backlog.ts`, `quiet.ts`, `src/core/scheduler/revision.ts`, `reconcileBatch` in `batch.ts`, `unstableInputs` in `tiers.ts`, `src/runners/pytest/**` and `test/keys/validity/**`. They shipped in 0.1.268; no row here edits them. The candidate is 0.1.269 unless another lands first.

`test/e2e/**` runs the committed bundle, and a worker tree does not build. Write and typecheck the e2e test. The coordinator runs it on the candidate.

## W1: 011-73, status, the hooks and the waits say a hold

Use /worker. Shape: slice.

Outcome: during a merge hold or a command hold, status, every hook and every wait name the hold and its cause. No held file reads FAIL. A wait started on hold returns at once with the hold as its verdict and exits 3.

Read board row 011-73; `tasks/011-61/design.md` sections 2 and 4 (R2) and "Spec text"; spec 011 C6, C8, C9 (*Unresolved merge*) and C15 (the two `queued, on hold ...` reasons); `tasks/011-72/notes.md`; `research/probes/issue-68/`.

Seam: `buildSnapshot` (`src/core/status/snapshot.ts:101`) reads `readMergeHold` and `readCommandHolds` (`src/core/scheduler/hold-rows.ts:63`, `:83`) into `holds`. Then `formatStatus` (`src/core/status/format-status.ts:52`) prints `On hold:` after the revision line. A lead: R2's test 1 first, on `test/scheduler/merge-hold-fixture.ts`. A holder whose processes are gone: `harnessGone` (`src/core/delivery/harness-process.ts:70`) on its wrapper and its command.

Owns: `src/core/status/`, `src/core/types/standing.ts`, `src/core/delivery/` (`header.ts`, `liveness.ts`), `src/cli/status-wait*.ts`, `verdict.ts`, `named-*.ts`, Stop's wait in `src/harness/shared/`, their tests, `test/e2e/merge-hold.test.ts`, notes under `tasks/011-73/`. Not yours: `src/core/scheduler/` (read its rows only), `src/core/daemon/`, `src/cli/main.ts`, `start.ts`, `hold.ts` (W2), the toolkit rows' files above, the board, spec text, bundles, version. No `npm run build`.

Done when: R2's tests 1 to 6 pass, and test 7 and `test/e2e/merge-hold.test.ts` are written and typecheck; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 011-74, `squeal hold [--max <d>] -- <command>`

Use /worker. Shape: slice.

Outcome: `squeal hold -- npm run gate` cancels the tiers it can and starts none while the command runs. Edits are still recorded and queued. The queued work runs when the last holder exits, at `--max` (default 3 h), or at `squeal start`.

Read board row 011-74; `tasks/011-61/design.md` sections 3 and 4 (R3) and "Spec text"; spec 011 C4 step 5 (the supersession cancel), C9 (*Hold command*) and C10; `tasks/011-72/notes.md`; `research/issue-49.md`.

Seam: a cancel that leaves the scheduler open, beside `#cancelTiers` (`src/core/daemon/daemon.ts:759`), which is terminal. Then the `hold` and `resume` requests in `protocol.ts` and `handlers.ts`, and the command-hold gate beside the merge hold in `#pump` (`scheduler.ts`). A lead: R3's test 1 first, with a fake runner whose tier cancels.

Owns: `src/cli/hold.ts` (new), `src/cli/main.ts` (the command table and `--help`), `src/cli/start.ts`, `src/core/daemon/` (`protocol.ts`, `handlers.ts`, `daemon.ts`), `src/core/scheduler/scheduler.ts`, `hold.ts`, `hold-rows.ts` (the command row's writer), `commands.md` in the three plugin copies (`plugins/{claude-code,codex,pi}/skills/squeal/references/`), their tests, notes under `tasks/011-74/`. Not yours: W1's files, the toolkit rows' files above, the primer (005's), the board, spec text, bundles, version. No `npm run build`.

Done when: R3's tests 1 to 7 pass; test 8's RSS is measured and in the notes; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## R1: review of cand/0.1.269

Use /reviewer. Shape: review. Pinned to `cand/0.1.269` at c41c365095380ed988078b0b94ea9449f650f836; the range is `origin/main..c41c36509`: W1's ten commits (011-73, worker 0288f1ff), W2's four (011-74, worker 0167bfa7), the release commit (0.1.269, bundles) and one docs commit (011 C6 and C9, `status.md`).

Read `tasks/wave-16.md` (W1, W2), the notes under `tasks/011-73/` and `tasks/011-74/`, board rows 011-73 and 011-74, `tasks/011-61/design.md` sections 2 to 4 (R2's tests 1 to 7, R3's tests 1 to 8), spec 011 C6, C8, C9 (*Holds*) and C15 as amended, and the two new `status.md` lines. Check that:
- 011-73: status, `--json`, every wait (`status --wait` with and without paths, `status <path>`, `run --all --wait`) and Stop's wait name the hold and exit 3 at once; no held file reads FAIL; a hold's start and end are told once each per consumer, and a hold change at Stop is news as a liveness change is; the merge row from a dead or earlier daemon is not shown;
- 011-74: the cancel leaves the scheduler open, cancels Vitest tiers (fast and slow) and re-queues their files, lets a node:test or pytest slot finish and starts none after it; the wrapper's exit codes, signals and `--max`; a holder judged gone (missing, PID reused, zombie) at heartbeat and start; a daemon started during a hold starts on hold; `squeal start` ends every hold; `squeal stop` leaves the row;
- the two rows agree: W1 reads the command row W2 writes (`CommandHoldEntry` in `hold-rows.ts`), and W1's `gone` and `expired` judge as W2's prune does;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is 0.1.269 in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then the test files W1 and W2 added or changed, directly; `test/e2e/merge-hold.test.ts` runs the committed bundle. The full suite is CI on the candidate and the coordinator's locked gate (`.ai/cezar/t/04a258b0/logs/gate-w16.log`); a gate log names only failing files. Rows 011-111 and 006-95 are known flakes. Write `reviews/0.1.269.md` with a PASS or FAIL verdict and commit it alone.

## Wave 16.5: repair of review 0.1.269

Review `reviews/0.1.269.md` failed cand/0.1.269 c41c36509 with B1 and B2 and one should-fix, S1. The two repairs own disjoint files, so they run in parallel. Each resumes its wave 16 worker in its own tree, on its own branch.

### W3: B1, a slow tier starts after the command hold settled

Use /worker. Shape: repair. Resumes W2 (0167bfa7, row 011-74).

Outcome: no runner call starts in any lane after `commandHold()` has returned `true`, a slow tier waiting on the load guard included, and the scheduler stays open with its queue.

Read `reviews/0.1.269.md` B1 and "Inputs for the fix wave", spec 011 C9 (*Holds*).

Seam: the pump's `await this.#slow.next()` and `#fly` in `src/core/scheduler/scheduler.ts` (`:491`, `:839`, `:885` at c41c36509), and `halted` in the slow host (`:239`). A lead: the review's load-guard probe as a regression, with a cancelling and a non-cancelling runner.

Owns: `scheduler.ts`, the slow selection guard in `src/core/scheduler/`, `command-hold.ts`, their tests, `tasks/011-74/notes.md`. Not yours: W4's files, `src/core/status/`, `src/core/delivery/`, the board, spec text, bundles, version. No `npm run build`.

Done when: the regression fails before and passes after for both runners; a selection that a hold crosses returns its claims and permits; the in-flight slow cancel still passes; `test/keys/key-format.test.ts`, lint, typecheck and the changed tests pass, their output in your summary.

### W4: B2 and S1, each hold change is told once and names its hold

Use /worker. Shape: repair. Resumes W1 (0288f1ff, row 011-73).

Outcome: with overlapping holds, each consumer is told each hold's start and end once, by name. `validating again` comes only when no hold remains. A command hold whose processes are gone and whose `until` has passed carries both `gone` and `expired`.

Read `reviews/0.1.269.md` B2, S1 and "Inputs for the fix wave", spec 011 C6 and C8 as amended.

Seam: `holdsChange` and `holdChangeOf` in `src/core/delivery/hold-told.ts` (`:31`, `:58`, `:79` at c41c36509), consumed at `delivery.ts:206`; `readHolds` in `src/core/status/holds.ts:72` for S1, with `command-hold.ts:108`'s reason precedence. A lead: the told slot keeps each hold's stable identity (a command hold's token, the merge cause), not its label.

Owns: `src/core/delivery/` (`hold-told.ts`, `delivery.ts`, `format.ts`), `src/core/types/delivery.ts` (`HoldChange`, additive), `src/core/status/holds.ts`, their tests, `tasks/011-73/notes.md`. Not yours: W3's files, `src/core/scheduler/`, the board, spec text, bundles, version. No `npm run build`.

Done when: tests for A, then B, then B removed, then A removed; a merge hold with a command hold; two holds with the same command; two consumers; a change first seen at Stop; gone and expired together. Also `test/keys/key-format.test.ts`, lint, typecheck and the changed tests pass, their output in your summary.

### R2: narrow re-review

Use /reviewer. Shape: review. Pinned to the re-cut `cand/0.1.269`: B1, B2 and S1 against `reviews/0.1.269.md`, the repair commits only, and the range-diff of the rest against c41c36509. Write `reviews/0.1.269-r2.md`. This is the last round: a second FAIL ends the loop.
