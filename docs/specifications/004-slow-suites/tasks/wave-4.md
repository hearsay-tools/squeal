# 004 wave 4 briefs: what dogfooding found (`lessons.md`, defects 1 to 9)

Common rules: do not run `npm run build`; keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start; re-run a failing file alone before calling it yours. Read `lessons.md` first.

## 004-30 the slow slot is handed over between files (defect 2)

Outcome: two worktrees' slow tiers interleave file by file, as D2 says, instead of the holder keeping the slot across its whole tier and its load waits.

Shape: repair. Test first: two schedulers sharing a slot directory, each with three slow files queued and a held load guard in the first; the second runs its first file before the first runs its second. Seam: `src/core/slow/slot.ts` and the slot handling in `src/core/scheduler/slow-tier.ts`: release the slot during the load guard's wait (take it after), and give a waiting worktree one turn (for example a waiter's mark in the slot directory the holder honours by skipping one turn). Keep the one-file-per-tier rule and the 15 s retry.

Owns: `src/core/slow/slot.ts`, the slot lines of `src/core/scheduler/slow-tier.ts`, `test/slow/slot.test.ts`, `test/scheduler/slow-tier.test.ts`. Leave alone: everything else.

Done when: the test; lint, typecheck, the slow and scheduler tests on Node 24 and 22.

Use /worker.

## 004-31 the slow-tier line's four wording slips (defect 8)

Outcome: the line says "sources changed since" only when a source of the declared artifact's build could have changed (not for a slow test file alone, and not for a fresh worktree's start scan), names the revision a current slow result actually ran at, and the text keeps the wait reason the JSON has.

Shape: repair. Test first: one test per slip (a), (b), (c), (d) from `lessons.md` defect 8. Seam: `src/core/state/slow.ts` and `slow-text.ts`.

Owns: `src/core/state/slow.ts`, `src/core/state/slow-text.ts`, `test/status/slow-tier.test.ts`. Leave alone: everything else.

Done when: the four tests; lint, typecheck, the status and delivery tests on Node 24 and 22.

Use /worker.

## 004-32 Squeal's own plugin paths leave the node:test key (defect 7, last point)

Outcome: two daemons of one Squeal version installed at different paths compute the same node:test keys, so a result inherits across them.

Shape: repair. Test first: the same project under two plugin roots keys the same. Seam: the node:test adapter's environment hash (`src/runners/node-test/adapter-environment.ts`) and the argv it keys: the recorder's `--require` and the reporter's `--test-reporter` paths are Squeal's own (as 003-35 treats its recorders in `NODE_OPTIONS`); key them by version, never by path. Raise `NODE_TEST_ADAPTER_VERSION` if keys change.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`. Leave alone: everything else.

Done when: the test; lint, typecheck, the node:test tests on Node 24 and 22.

Use /worker.
