# Wave 90.5: repair of cand/0.1.489 (rows 011-44 and 011-45), the database moves both markers

Coordinator cdd216e5, 2026-11-14. Review `reviews/0.1.489.md` FAIL on `73c8277ea`, one proven blocker B1: the markers move only when a writer of this release bumps them, and the trust rule (`everyDaemonClaims`) sees only the daemons registered at the read. An older daemon that registers, writes and exits between two reads, or an older `squeal code` gate that writes through `storeResults` with no daemon, leaves both caches stale (actual edit poll: `timeout`, 0 transitions, where `5e8dcc223` gives `news`, 1).

Coordinator's decision (single owner of the rule): the database moves the markers, for every writer of every release. Triggers, not writers, own "a write to these rows moves its marker".

## W1: repair, worker 6702c043 resumed (both markers)

Use /worker. Shape: repair, test first. Effort high.

Start: `git reset --hard 73c8277ea` on your branch (it holds your four commits, the 011-44 commits and the coordinator's). Read `reviews/0.1.489.md` (B1, the two sequences, the fix), `tasks/011-44/notes.md`, your notes, `src/core/store/covered-files.ts` and `imports.ts` (`ensureImportTables`: additive objects made outside `schema.ts`, no `user_version` raise, off the key-format path).

1. **Regression first.** The review's two sequences, with writes that run no marker code (raw SQL or `5e8dcc223`'s repositories): (a) an older daemon registers, writes a recovered state and a closure that adds the source path, and clears its registration before the next read; (b) an older gate writes through `storeResults` with no daemon. Compare the cached poll's outcome and transition count with an uncached read, with unrelated work pending; and the named selection after the path is added and dropped. Red on `73c8277ea`.
2. **Triggers.** `AFTER INSERT`, `UPDATE` and `DELETE` triggers on `known_states` and `test_file_keys` move that worktree's states marker; on `test_files`, the store's closure marker. Made with `IF NOT EXISTS` by this release, outside `schema.ts`, with no `user_version` raise. A value a store made again cannot repeat (as the closure marker's random value).
3. **Trust = the triggers exist**, read in the same read as the marker and the rows; otherwise every poll reads in full, as at `5e8dcc223`.
4. **Replace, don't layer.** Delete the writer bumps (repositories, ledger, `storeClosures`, `addClosures`), the registration claim, `everyDaemonClaims` and the writer source-scan tests; name each in the notes.

Owns: `states-marker.ts`, `closure-writes.ts`, the new trigger file, the files whose bumps you delete, `every-state.ts`, `stored-closures.ts`, their tests, both rows' notes. Leave alone: `src/cli/code*.ts`, `src/core/presence/`, `KEY_FORMAT_VERSION`, `plugins/*/dist`, the board.

Done when: both sequences pass; the counting tests still read nothing on quiet polls; `test/keys/key-format.test.ts` passes with no raise; lint and typecheck pass; the added cost of a large `known_states` upsert (e.g. 30,000 rows) with and without the triggers, at the host's stated load, is in the notes; Squeal on your changed files, at most 15 minutes. Report commits, checks and any call the review did not settle.

## R7: re-review of cand/0.1.489 after the repair

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43614740989. Pinned to `cand/0.1.489` at `30946367e14c0d6a1773886451bc114b06427b67`, rebuilt on main `658323041` (main changed only docs since `5e8dcc223`): the failed candidate's commits without its bundle commit (`d5e3b43a5..71a5d2c6c`), then the repair of worker 6702c043 (`27493309c..8a6f09da1`: regression tests first, then the triggers, then notes), then the 0.1.489 raise and bundles. Behaviour to compare against: `5e8dcc223`. Read: `reviews/0.1.489.md` (B1), this file's W1, the repair section of `tasks/011-45/notes.md`, `src/core/store/write-markers.ts`.

Check, each as proven, plausible or unverified:

1. **B1 is closed.** The review's two sequences (an older daemon that registers, writes and exits between reads; an older gate writing through `storeResults` with no daemon) give the same outcome and transitions as an uncached read, and the named selection follows the older closure writer; `test/cli/older-writers.test.ts` fails on `73c8277ea`.
2. **The triggers are the one owner.** Every insert, update and delete of `known_states`, `test_file_keys` and `test_files`, by any writer of any release, moves its marker in the writer's transaction; a value cannot repeat after a store is made again. No writer bump, claim or `everyDaemonClaims` is left.
3. **Trust needs the triggers.** A reader trusts a marker only while its table's triggers exist and the marker row exists, read in the reader's read transaction; otherwise every poll reads in full as at `5e8dcc223`. The worker's calls 1 to 4 in its notes hold.
4. **Older releases are safe with the triggers present.** They open the store (no `user_version` raise), and their writes, removals, pruning, transfer import and store recovery work; a trigger cannot fail an older writer's transaction.
5. **Rows' outcomes and cost.** First review's checks 1, 3, 5 and 6 still hold; the added write cost (30,000-row upsert, median +59 ms, +18%) is plausible and acceptable for the daemon.
6. **Key format**: `test/keys/key-format.test.ts` passes with no raise.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format`, `version-sensitive`, every changed test file and `worktree-meta` (10 files, 58 tests), and 68 files that read the store schema, transfer, `user_version` or integrity plus the bundle and package tests (587 tests), at the candidate. Host policy as in `wave-85.md`; never the real `HOME`; signal only processes your probe started. Write `reviews/0.1.489-r2.md` and commit it on your branch.
