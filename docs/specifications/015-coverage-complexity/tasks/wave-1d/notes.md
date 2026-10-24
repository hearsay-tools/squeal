# 015 wave 1d notes: the complexity defects from the working day

Worker 91422c1b, 2026-10-24. Brief: `tasks/wave-1d.md` W1, rows 015-34 to 015-37. From main `0aff41b56` (0.1.295).

## 015-34: an operation git stopped is not the agent's edit

### Seam

- `committedPaths` (`src/core/code/pass/head.ts`) now asks `git cat-file --batch-check` for each file at every revision git brought files from: the moved `HEAD` (015-19), and `operationRevisions(root)`. The pass (`pass.ts`) is unchanged: it already filters `judged.edited` by the set.
- `operationRevisions` reads the worktree's git dir with no spawn (`findWorktreeRoot`, then `gitDirOf`, so a Squeal root below the top and a linked worktree work). It gives each line of `MERGE_HEAD` (an octopus merge has several), `CHERRY_PICK_HEAD`, `REVERT_HEAD^` (a revert brings the reverted commit's parent, not the commit), `REBASE_HEAD`, and the name `HEAD` while `rebase-merge/` or `rebase-apply/` exists. A file it cannot read gives nothing, so the edit stays marked.
- `HEAD` during a rebase: a rebase moves `HEAD` at each step, and a revision can see a step's files after the revision that recorded its `HEAD`. Then `movedHead` finds no move for the revision with the files. Asking `HEAD` at the pass while the rebase is under way covers it. This is the likely cause of the coordinator's 17:45Z `countTree` line; it is not verified against that session.
- Cost: an edit pass with no operation under way now does about ten `stat` and `open` calls and spawns nothing. The `cat-file` call runs only when there is a revision to ask.

### Tests (red first)

`test/code/pass/operation.test.ts`, on real git operations in the rig's repository: a stopped merge, a stopped cherry-pick, a stopped revert, a rebase step stopped by a conflict (`HEAD` at main's tip, where it was), and a rebase stopped by `break` with the file seen one revision after its `HEAD`. Each marked `settle` as edited before the change (5 red), and each tells no `STILL FAIL` after it; the merge, cherry-pick and rebase tests then edit the file and get one `STILL FAIL`. The sixth test (green before and after) checks that `git checkout topic -- src/a.ts` with no operation under way is still an edit. `head.test.ts` adds a stopped merge in a linked worktree, root below the top, `HEAD` unmoved.

Test helpers: `FakeWorktree.branch`, `run` and `reread` (`test/code/pass/helpers.ts`). `branch` adds only its own files: `git add -A` committed the rig's untracked `squeal.config.json`, and the checkout back deleted it, so the policy read as off.

### Limits, accepted

- `sequencer/` (a cherry-pick or revert of several commits between steps) is not read: with no stop, each step moves `HEAD`, and 015-19 applies. A stop writes `CHERRY_PICK_HEAD` or `REVERT_HEAD`.
- A conflict the agent resolves by taking one side whole (`git checkout --theirs`) gives a file equal to the incoming blob: no edit is marked. A resolution by hand is an edit.
- A rebase that ends between a revision's `HEAD` and the next revision's files leaves no git-dir trace to ask; 015-19's split-revision limit stays for that case.

### D6 amendment text (the coordinator owns `spec.md`)

Under "The first edit to a standing failure", after the 015-19 sentence: "While a merge, cherry-pick, revert or rebase is under way (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `REBASE_HEAD` exists, or `rebase-merge/` or `rebase-apply/`), a file whose bytes are its blob at a commit the operation brings marks no edit: each `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REBASE_HEAD`, the parent of `REVERT_HEAD`, and, during a rebase, `HEAD` (amended 2026-10-24, 015-34)."
