# Spec 018 wave 2: export and import

Dispatch after 018-06 is integrated on the coordinator's branch; the coordinator adds 018-06's final interface note here first.

## 018-07 `squeal export`, `squeal import`, the imported origin, status counts

Use /worker. Shape: slice.

Outcome: results move from one store to another, count where the local key is equal, and status says how many are current and why the rest are not.

Read: `spec.md` D2 to D6; `research/result-import.md` Q2, Q5, Q6; 018-06's interface note below.

Starting seam: a round-trip test first, with two fixture stores (`test/store/helpers.ts`: `fakeCommonDir`, `open`, `worktree`, `result`; `test/store/test-key.ts`). First edit offered as a lead: a new `src/core/store/transfer.ts` with `exportResults(db, worktreeId)` and `importResults(db, bundle)`, using `putMany` and `ensureCheckId` (`src/core/store/repos/results.ts`). Then the CLI (`src/cli/main.ts` `COMMANDS` and `HELP`; writes as `src/cli/store-writes.ts` and `retry.ts` do), then the origin (`src/core/state/derive.ts` `originOf`, `src/core/types/state.ts`, `src/core/store/repos/states.ts`) and every `origin.kind` site, then status (`src/core/status/status-detail.ts`, `snapshot.ts`, `src/core/types/status.ts`, `src/core/delivery/header.ts`).

Pitfalls the code reading found: imported rows need `recorded_at` at import time or a running daemon's `StoredKeys` misses them; `states.ts` reads origin kinds with `oneOfOrNull`, so check how an older daemon on the same store reads a known state of kind `imported` before choosing where the kind is stored (D4).

Owns: `src/core/store/transfer.ts` and an imports-table file beside it, `src/core/store/repos/results.ts`, `src/core/store/repos/test-files.ts`, `src/core/keys/observed.ts`, `modules.ts`, `startup.ts` (add-only helpers), `src/cli/`, `src/core/state/`, `src/core/delivery/`, `src/core/status/`, `src/core/types/state.ts`, `src/core/types/status.ts`, their tests.

Leave alone: 018-06's files except through their exports; `src/core/store/schema.ts`; any key input. `test/keys/key-format.test.ts` must pass unchanged.

Done when: the spec's Testing items for D2 to D5 pass; `squeal status --wait 60000 <changed paths>` shows affected tests current and passing; lint and typecheck clean; no `pnpm run build` in the worker tree. Final message: the plain `status --full` and `why` text of an imported result from the round-trip fixture, and any choice the spec did not settle.

## 018-06 interface note

(Filled in by the coordinator after 018-06 integrates.)
