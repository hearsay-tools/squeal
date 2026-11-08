# Spec 018 wave 2: export and import

Dispatch after 018-06 is integrated on the coordinator's branch (done 2026-11-08).

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

From worker e21f67ca's final message (commits `4217f8b34`, `528546822` on its branch):

- Build: `environmentRecord(core, runner, hashOf, ci: boolean, format?)` in `src/core/keys/environment-hash.ts` returns `{ hash, descriptor }` from one reading of the runner files.
- Compare: `describeDifferences(a, b): Difference[]` in `src/core/keys/environment-descriptor.ts`; `a` is the export, `b` this worktree. A `Difference` has `part`, `values?` (plain parts), `names?` (hashed parts) and `text`. `sawCi(env): boolean`.
- Write (`src/core/store/environments.ts`): `putEnvironments(store, records, now)` for import (D3 step 5; throws on a store `openStore` did not open); `recordWorktreeEnvironments(store, worktreeId, records, now)` is the daemon's.
- Read: `readEnvironment(store, hash)`, `worktreeEnvironments(store, worktreeId)`, `worktreeEnvironment(store, worktreeId, project)`; `StoredEnvironment` is `{ project, hash, descriptor | null, recordedAt }`. Readers return `null` or `[]` before the first write and for a descriptor they cannot read.
- Per-worktree table: `worktree_environment_hashes` (not `worktree_environments`).
- Bundle drift: until the coordinator rebuilds, the four bundle-drift tests (`test/harness/plugin.test.ts` and the codex, opencode, pi packaging tests) fail with "cli/squeal.mjs differs from the build". That is expected in a worker tree; do not run `pnpm run build`.
