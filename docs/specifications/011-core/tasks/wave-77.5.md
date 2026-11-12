# Wave 77.5: repair R1 of row 011-320 (review 0.1.458)

Coordinator bef76bfb, 2026-11-12. Review `reviews/0.1.458.md` failed `cand/0.1.458` (`c4593e4c2`) on four proven blockers: in each, `squeal code` still keeps a result the daemon does not store, in a case row 011-320 covers. No daemon decision changed and no store write was added (proven). One repair, then a narrow re-review (`docs/process.md` step 6); a second failure goes to the human. Host policy and "not yours" as in `wave-76.md`.

## W1-R1: the repair

Use /worker. Shape: repair. Worker ea62d171, resumed on its own branch `cez/ea62d171` (do not rebase; the coordinator cherry-picks onto the candidate). One commit per blocker. Each test runs the real source (keys, index, store, policy), not an injected string.

Read: `reviews/0.1.458.md` (B1 to B4, "Judgment of the listed source gaps", "Inputs for the repair review"); your `tasks/011-320/notes.md`.

1. **B1, a file added and removed during the run.** Where a daemon serves, read its revisions since the lookup (read only, `store.revisions`), and count every listing an ordinary structural change moved, as `Tier.changes` does; keep the scratch rule (a scratch file that came and went moves nothing). Without a daemon, the before-and-after comparison stays. Table row: the two-revision case of B1.
2. **B2, a file added through a symlinked directory.** Include the files below the linked directories the watcher follows, by its scope rules (`src/core/watcher/linked-*.ts`, `candidates.ts`; ignored paths and nested repositories left out), in both the copy before the run and the read after it. Table rows: an ordinary and a scratch file added through a link; the unchanged-link row stays.
3. **B3, a runtime policy edit during the run.** The end source reads the runtime identity under the policy as it is at the decision, or refuses the keep when the policy's runtime rules changed since the lookup. Keep the source optional for the agreed test callers. Table row: the real `runtimeFiles` edit of B3.
4. **B4, the merge hold before each write.** Check the merge hold before every new write attempt, the first successful one included, and between the coverage write and the results write. You may edit `src/core/code/gate/keep-write.ts` for this (granted; rows 020-37 and 021-20 that touched it have landed): add an unconditional guard beside `InputCheck`, leaving its busy and lost-try input check as it is. Tests: the `head()` seam of B4 and a merge between the two writes.
5. **Notes.** Update the sources, the gaps and the D17.3 wording.

Owns: as in `wave-77.md` W1, plus `keep-write.ts` for item 4 and read-only use of `src/core/watcher/**`.

Leave alone: as in `wave-77.md` W1 (except `keep-write.ts`); `src/core/watcher/**` unchanged. No daemon decision, store write, key or `KEY_FORMAT_VERSION` change. Stop and ask if one would.

Done when: each blocker's case is a table or keeper test that fails before your fix and passes after; the table's other rows, the keeper's and the scheduler's tests and the gate's CLI tests pass unchanged; key-format and `test/keys/validity/` pass with no raise; lint and typecheck pass; `squeal status --wait 60000 <paths>`. Your final message lists each blocker's commit.

## R2: narrow re-review

Use /reviewer (codex gpt-6.1-sol high), pinned to the repaired candidate. Scope: B1 to B4 of `reviews/0.1.458.md` and the repair delta only; the first review's "What fits" stands for unchanged lines. Write `reviews/0.1.458-r2.md`.
