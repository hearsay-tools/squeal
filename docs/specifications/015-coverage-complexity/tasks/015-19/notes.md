# 015-19 notes: a pull is not the agent's edit

Worker dfb1ce2a, 2026-10-24. Brief: `tasks/wave-1b.md` W1. Commit `6b10cc539`.

## Seam

- `runPass` (`src/core/code/pass/pass.ts`) filters `judged.edited` before `markEdited` and the report. `judge` stays pure and unchanged.
- `committedPaths` (`pass/head.ts`) asks `git cat-file --batch-check` for `<new HEAD>:./<path>` of each counted work-set file, and only when `HEAD` moved. `./` resolves from the root, so a Squeal root below the repository's top works.
- `PassSource.movedHead(after, upTo)` (`pass/types.ts`, `pass/source.ts`) compares each revision's recorded `HEAD` (011 C2, `Revision.head`) with the one before it. `HEAD` at the cursor comes from the task 001-406 `head-move.` meta record when that record is at the cursor's revision, else from the cursor's revision.

## What the tests found

- The daemon's start makes no revision. A worktree's first revision has no earlier revision to compare with. The scheduler's `recordHeadMove` writes `HEAD` at revision 0 (the ledger starts with `HEAD` null), so `movedHead` reads it there. With no record either, `movedHead` gives the last `HEAD`, and the pass asks git. Without this, the real fast-forward merge in `daemon-loop.test.ts` still marked the edit.

## Limits, accepted

- An edit and a commit in one revision (`sed -i … && git commit -am …` inside one watcher batch) look like a pull: the agent gets no `STILL FAIL`. Its `FAIL` or `PASS` is still told. Only the reflog could tell them apart.
- A revision's `HEAD` is read after its files are diffed. A checkout or rebase can be split over two revisions, with the first one's files at the old `HEAD`. Those files' bodies still mark an edit. The real `git merge --ff-only` test did not hit this.
- A `git checkout -- <file>` or `git stash` with `HEAD` unmoved is still an edit, as before.

## Spec text the coordinator owns

Proposed D6 amendment, under "The first edit to a standing failure": "A revision that moves `HEAD` (a pull, merge, rebase or checkout) marks no edit for a file whose bytes are its blob at the new `HEAD`. A `FAIL` or `PASS` from it is still delivered."
