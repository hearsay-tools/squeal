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

## W1 widened (the human, 2026-11-12)

"Folder case: Add to the running row": row keep-listing-revision joins 011-320. Steered to worker ea62d171: `squeal code` does not keep a completed file when a file was added to or removed from a directory its key lists, during the run (the daemon decides "unstable" through `Tier.changes`). The table row "a revision during the run moved a listed directory, no input's bytes" flips its keeper column to the daemon's decision. The source works with and without a serving daemon; the note names the directory; the notes give the cost on a run in this repository. One commit.


## R1: review of cand/0.1.458

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.458` at `c4593e4c2dfdc40b744eab74968ff80a0aa97716`; range `8f945a59b..c4593e4c2` (nine worker commits of ea62d171, cherry-picked onto 0.1.456 with one resolved conflict in `test/cli/code-gate-children.test.ts`, then the 0.1.458 bundles). Read: board row 011-320 (widened by the human), `research/run-evidence.md` differences 2 to 4, `tasks/011-320/notes.md`, this file's W1 and "W1 widened". Candidate CI: run 43262584600.

Check, each as proven, plausible or unverified:

1. Each of the five checks (runtime identity, merge hold at the decision and at each write, editor scratch, a file added to or removed from a listed directory, the bounded note) refuses a keep exactly where the daemon would not store at the key it ran under, and never keeps a file the daemon would not store. The two rows where the keeper is stricter than the daemon (no revision of the change) are acceptable only if stricter, never looser.
2. No daemon decision changed: `record.ts`, `record-tier.ts`, `store-decision.ts`, `src/core/daemon/**` unchanged; the `hold.ts` change is type only and its emitted code is the same; the daemon's `mergeHeld` path is equivalent.
3. `squeal code` makes no new store write; the listing check's git reads and their failure modes (ignored files, symlinked directories, submodules, a failed read) behave as the notes say.
4. Verdict, report JSON, `--json` stdout and exit code are unchanged; each note line is bounded (three files, three paths, "and N more").
5. The merged expectation in `test/cli/code-gate-children.test.ts` keeps both 020-34's hint line and 011-320's not-kept line.
6. `src/core/scheduler/store-decision.ts` unchanged; `test/keys/key-format.test.ts` passes against `squeal--v0.1.455` with no raise.
7. Judge the gaps in the notes ("Cases a source does not cover"): is any of them a keep this row claims to refuse?

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; affected results through `squeal status --wait 60000 <paths>`. Write `reviews/0.1.458.md` and commit it on your branch.
