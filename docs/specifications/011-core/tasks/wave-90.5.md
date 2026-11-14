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
