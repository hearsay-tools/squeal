# Wave 38

From main after 011-203 and 011-195 landed as tests, 2026-10-25, on the human's hold of 011-204. One worker, the third round of 011-204, as one rule. The human chose it over landing cand/0.1.310 with note N1 (`reviews/0.1.310-r2.md`).

## W1: 011-204 round 3, a hash is stored only beside two stats that agree

Use /worker. Shape: repair. Row 011-204 in `docs/board.md`. Resume of worker c68447bc on its branch.

Outcome: `diffCandidates` stores a hash only beside a stat taken before its read and one taken after it that agree, so a write during the read gives no touch, is not lost across a restart, and a tier's snapshot still sees a write and its restore.

Read `reviews/0.1.310.md` (B1) and `reviews/0.1.310-r2.md` (N1 and its follow-up); `tasks/011-203/notes.md`; spec 011 C2's touch paragraph (a revert and its restore inside one batch), C7.

The rule: stat, read, stat. When the two stats agree, store the hash with them. When they differ, read again with the later stat as the new "before", up to 3 reads in all. Only a file that never settles is stored with `unknownStat`, and every touch check treats such an entry as touched, not skipped (`touchedUnchanged`, `src/core/scheduler/stability.ts:70`). A change is reported in the batch that read it, as now.

Seam: the read in `diffCandidates` (`src/core/revision/reconcile.ts`). First edit, offered as a lead: one function that returns a hash with its agreeing stat, or the sentinel after the third read.

Owns what 011-204 owned: `reconcile.ts`, `stat-cache.ts`, `touchedUnchanged`, their tests, the validity harness cases for 011-204. Not yours: the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when: N1's sequence (a write during the read, a tier snapshot, then other bytes and a restore) is a touch, and it fails on `1d7944a30`; B1's real-store reopen and the direct reload still pass; a write before the read gives its own batch no touch; a file that never settles is touched and is hashed again after a reload; `linked-start.test.ts` 20 of 20; the key-format alarm names no line, and compare-refs shows keys equal at `squeal--v0.1.307`, or a request to me with the case if they differ; lint, typecheck, `squeal run --all --wait` (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
