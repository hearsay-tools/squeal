# Wave 77: row 011-320 (`squeal code` applies the runtime, merge-hold and editor-scratch checks)

Coordinator bef76bfb, 2026-11-12. The human approved row 011-320 (architecture review task af6c0b3f, "B: move, then checks 2-4"). Row 011-319 landed on main as 0.1.453 (`c6d2f2db9`); this wave builds on its module. One worker; review before main.

Host policy and "not yours" as in `wave-76.md`. Spec 020's D17.3 text is the coordinator's edit: put your proposed wording in your notes.

## W1: row 011-320

Use /worker. Shape: slice, test first, one commit per check.

Outcome: `squeal code` keeps no test file the daemon would not store at the key it ran under for these three kinds of evidence: a runtime identity that moved during the run, a merge that holds a path the key names, and an editor's scratch file that moved a listed directory. Its note names the reason. Each makes `squeal code` stricter: fewer kept results, never a wrong keep.

Read: board row 011-320; `research/run-evidence.md`, differences 2 to 4; `tasks/011-319/notes.md`; spec 020 D17.3 and D17.5; spec 011 C9 (merge hold) and row 011-117 (editor scratch).

Seam and lead: `readKeepEvidence` (`src/core/run-evidence/sources.ts`) and `keepDecisions`/`KEEP_FACTS` (`run-evidence.ts`). In `test/run-evidence/table.test.ts`, the keeper column of rows "difference 2", "difference 3" and "difference 4" reads "store at ran". First edit: change those three expectations to the daemon's, and watch them fail. Then supply each source:

1. Runtime identity: record `keys.runtimeIdentity(ref)` for each file when the lookup expects it (`Expectations.add`), and compare at the end, as `TierFile.runtimePolicy` and `runEnd`'s identity do for the daemon.
2. Merge hold: read the worktree's unmerged index paths at the decision (as `MergeHold` reads them), and pass them as `RecordFacts.held` through `mergeHeld` or its equivalent. Say whether the write-time recheck (the `steady` callback in `keep.ts`, `stillAsRead`) should read them again, as the daemon's `#heldNow` does at each try, and do it there if it costs no new store write; `keep-write.ts` stays as it is.
3. Editor scratch: find a source that works with and without a serving daemon. With a daemon, the store's revisions during the run hold scratch moves (`scratchMovedListings`); without one, no revision is written. Report which cases your source covers, with a table row for each.
4. The note: one line per reason kind for the files not kept, in the keeper's `note`, plain words, naming the paths. Verdict, report JSON and exit code do not change.

Owns: `src/core/run-evidence/**`, `test/run-evidence/**`, `src/core/code/gate/keep.ts`, `keep-expected.ts`, `src/core/code/gate/stored.ts` (only to give the keeper its sources), and one new CLI case in `test/cli/code-gate-keep.test.ts` for a merge hold's note.

Leave alone: `store-decision.ts` (byte for byte), `record-tier.ts`, `record.ts`, `keep-write.ts`, `keep-sent.ts`, `keep-here.ts`, `src/core/daemon/**`, `test/code/gate/keep-busy.test.ts`, every key computation, `KEY_FORMAT_VERSION`. The listing moved by an ordinary revision (proposed row `keep-listing-revision`) and observed reads without a daemon (difference 1) are not this row's: their table rows stay as they are.

Stop and ask the coordinator if the daemon's decisions or `store-decision.ts` would change, if the key alarm asks for a raise, or if a source needs a new store write from `squeal code`.

Done when: the table's keeper column equals the daemon's for differences 2 to 4, in every case your sources cover; a kept file is never one the daemon would not store at the key it ran under; the note names the reason; the keeper's other table rows, the scheduler's tests and the keeper's CLI tests pass unchanged; `test/keys/key-format.test.ts` and `test/keys/validity/` pass with no raise; lint and typecheck pass; affected results through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-320/notes.md` with the proposed D17.3 wording. Your final message lists decisions the design did not settle and each case a source does not cover.
