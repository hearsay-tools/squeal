# 005 wave 28: the header's daemon sentences in their own module; the registration leaves delivery.ts; a cut-short store mark

Rows 005-119, 005-120 and part (d) of 011-392, from the quality scan `quality/2026-11.md`. The human chose the rows on 2026-11-17. Coordinator: session 4d2ecbfc. Three workers, disjoint. Baseline: main at 0.1.557.

Rules for all: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report, but do not wait longer than 20 minutes for a queue under host load: then run the test files of the directories you changed directly, one at a time, `timeout 900`, and say which you ran. The bundle tests fail on drift until the coordinator builds, which is expected. Grep `test/`, `test/e2e/**` and `evals/**` for anything you rename or reword. Write `~`, never a `/home/<user>/` path. Never run a script under `evals/bin`.

Scope for W1 and W2: the board row in `docs/board.md` and the row of the same content in `quality/2026-11.md` ("Board rows"). Read both in full. The line numbers in the quality file are from before 0.1.551: find each place by name. Both rows are moves with no behaviour change and no text change: every existing test passes unchanged, apart from import paths.

## W1: 005-119, the header's daemon sentences read the told state, in their own module

Use /worker. Shape: slice. Quality row `proposed-header-liveness-one-state`. Since the scan: row 005-111 added the stopped start (`startStoppedText`, the title "a starting daemon may be stopped"), row 005-116 added `deathHookText`, `headerRestarts` and the one `squeal start` per message, row 005-114 added `lateCarriesDelay`, and row 005-118 made `toldOf` the one decision of the presence state. Keep all of them. If one of the three functions cannot switch on `toldOf(live).state` without a text change, leave that function and say why.

Owns: `src/core/delivery/header.ts`, the new `src/core/delivery/header-daemon.ts`, `livenessTitle` in `src/core/delivery/format.ts`, their tests. Leave alone: `src/core/presence/**`, `src/core/delivery/{delivery,edits,late*}.ts`, `src/harness/**`.

## W2: 005-120, the registration leaves `delivery.ts`; the own counts leave `edits.ts`

Use /worker. Shape: slice. Quality row `proposed-delivery-register-split`. Since the scan: row 005-113 added `markedWrites` (`view-mark.ts`) to the deliver transaction, row 005-111 one condition in `tellAtRegistration`, row 005-115 the `readLiveHeader` options object, row 005-118 an import of `toldAtRegistration` from presence. Keep all of them. The deliver transaction stays where it is. `test/keys/key-format.test.ts` must pass: if the move changes the validity bundle, stop and report.

Owns: `src/core/delivery/{delivery,edits}.ts`, the new modules beside them, imports of the moved names, their tests. Leave alone: `src/core/delivery/{header,format,late*,view-mark}.ts`, `src/core/presence/**`, `src/harness/**`.

## W3: 011-392 part (d), a store mark that cannot be read is not told as a full-check fault

Use /worker. Shape: repair, failing test first. The scope is the section "(d) A mark cut short" of `docs/specifications/011-core/tasks/011-392/notes.md`: do its proposed change with the finder value `"unknown"` (no new field), points 1 to 4, and its test. The texts (the coordinator's decision): the daemon-stop note says "a fault was marked on the store (the mark beside the store could not be read)"; the status recovery note has no "found by" clause for an unknown finder. A mark that parses and has no `found` stays the full check's.

Owns: `src/core/store/{mark,open}.ts`, `src/core/daemon/store-file.ts`, `src/core/status/snapshot.ts`, the `StoreMark` type where it lives, their tests. Leave alone: everything else.

Final message, each worker: the commit, what moved or changed with file names, any behaviour or text change, check results with their commands.
