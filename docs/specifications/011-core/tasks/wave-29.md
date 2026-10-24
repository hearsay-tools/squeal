# Wave 29

From main `4b432d1f8` (after 0.1.286; 0.1.287 is in review and touches neither row's files). Two refactor rows from `quality/2026-10-24.md`, on disjoint files, run side by side. No behaviour or printed text changes. Both go into one candidate after 0.1.287; the coordinator integrates.

## W3: 011-171, a focused wait decides in one place, with slices 1, 3, 4, 5, 11 and 011-172 slice 6

Use /worker. Shape: slice (subtraction).

Outcome: the focused wait's outcome and its usage error each come from one function, one reader says when a focused run applies, and the eight small duplicates the slices name are gone.

Read board rows 011-171 and 011-172; `quality/2026-10-24.md` ("Known candidates", row 011-171, slices 1, 3, 4, 5, 6 and 11); `reviews/0.1.286.md` and `reviews/0.1.286-r2.md` (B1, B2, B4, B6 are the cases the merged paths must keep); 011 C6 and C15.

Seam: start with (a), the outcome chain at `src/cli/status-wait-paths.ts:443-454`; keep one function in `status-wait-focus.ts` that takes the named outcome, the focus and the daemon's reply. Then (b) to (d), then the slices.

Owns `src/cli/status-wait-*.ts`, `src/cli/status-paths.ts`, `src/cli/named-file-lines.ts`, `src/core/status/{focused,phase-files,outstanding-text,unknown-files,test-frame}.ts`, `src/core/state/slow-text.ts`, `src/core/text.ts`, `src/harness/shared/test-command-reason.ts`, `src/runners/focus.ts` (import only), their tests, `tasks/011-171/`. Not yours: `src/core/scheduler/`, `src/core/store/`, `src/core/types/store.ts` (W4), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when and each slice hold, every existing text test passes unchanged, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W4: 011-172, quality 2026-10-24 slices 2, 7, 8, 9, 10 and 12

Use /worker. Shape: slice (subtraction).

Outcome: the six scheduler and store duplicates the slices name are one each, and `newestForTestFile`'s tie rule is stated and pinned.

Read board row 011-172; `quality/2026-10-24.md` slices 2, 7, 8, 9, 10 and 12; `reviews/0.1.279.md` N1 (slice 12's probe); `tasks/011-160/notes.md` (slice 7, the human's "no separate log rule"); 011 C4 and C7.

Seam: slice 10 first, one `newTier(context, ledger, files, kind)` in `src/core/scheduler/tiers.ts` that `startFocusedTier` (`focused.ts:133`) and `startTier` share; slice 2 then makes `focuses` call `focusesFile`. Slice 7 keeps prune's run delete in one transaction.

Owns `src/core/scheduler/{focused,tiers,quiet,stored-keys}.ts`, `src/core/store/prune.ts`, `src/core/store/repos/results.ts`, `src/core/types/store.ts`, their tests, `test/store/newest-for-test-file.test.ts`, `tasks/011-172/`. Not yours: `src/cli/`, `src/core/status/`, `src/core/text.ts` (W3), `src/runners/vitest/` (0.1.287), the board, spec text, bundles, version. If the key-format alarm asks a raise, stop and send me a request. No `npm run build`.

Done when each slice holds as its quality entry says, prune deletes the same rows as before (a test), and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
