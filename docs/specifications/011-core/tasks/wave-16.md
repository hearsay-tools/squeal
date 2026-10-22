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
