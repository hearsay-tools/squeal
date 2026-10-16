# Issue 9: Git identity after committing validated edits

Topic `issue-9-git-identity` (research brief). Squeal 0.1.199 (installed plugin through `~/.local/bin/squeal`), source at `a645f06e`, which has the same `src/core/status`, `src/core/state` and `src/core/scheduler/head-move.ts` as tag `squeal--v0.1.199` (`git diff --stat` empty). Vitest 5.0.3. Issue: https://github.com/hearsay-tools/squeal/issues/9, read 2026-10-16 with its one comment.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does committing validated bytes with no new file revision give status two Git identities that contradict each other? | Yes, reproduced. Once the idle reconciliation pass sees the commit, the header reads `Revision: 1 · f512f5c3 + 0` (clean) and the Worktree line reads `HEAD ae73b66, dirty at revision 1`. JSON gives `commit.head` = new, `commit.dirty` = false, and top-level `head` = old, `dirty` = true. This lasts until the next revision. Before the pass (about 30 s) both lines are stale and agree with each other. After `squeal stop`, the header still implies clean. The revision stays 1 throughout. | verified by experiment |
| 2 | Overlap with existing rows; what the issue adds | 001-406 added a second reader (the head move) and wired it to the header, `why` and JSON `commit` only. The Worktree line and the top-level fields still read the latest revision row, which 001-24 N7 and 001-43 defect 7 shaped. No open row covers this. The issue adds a field report from a real session. This research adds the 30 s stale window and the header claiming clean with no daemon. | read in source code, verified by experiment |
| 3 | Fit with the vision | It goes against provenance (vision l. 36), "trustworthy state over optimistic claims" (l. 204) and filter question 2 on unnecessary blocking (l. 263): the issue reports an agent running its own Git check. Test validity is not affected: results are keyed by content. | inferred |

## Findings

**1. Reproduction** (verified by experiment, 0.1.199; logs in `probes/issue-9-git-identity/`). The fixture was a fresh `git init` with one Vitest file, `squeal init`, everything committed, `squeal start`, then `squeal run --all --wait`, which passed at revision 0. I then edited `src/sum.js` and `test/sum.test.js`. `squeal status --wait 60000` returned with `Revision: 1 · ae73b662 + 1, dirty` and `Worktree: … (HEAD ae73b66, dirty at revision 1)`, which agrees with `git status --porcelain` (` M` on both files). Then `git add -A && git commit` at 22:40:01.5.

- **Phase A, 0 to about 30 s after the commit.** `git rev-parse HEAD` = `f512f5c3…` and porcelain is empty. Both `squeal status` lines still say `ae73b66`, dirty, and so does JSON (`commit.head` and `head` both `ae73b662…`, both dirty `true`). The two lines agree with each other but disagree with Git. The polls at 22:40:06 to 22:40:27 all match.
- **Phase B, from the poll at 22:40:32.8 onwards.** The text shows the contradiction:
  ```
  Revision: 1 · f512f5c3 + 0
  Worktree: /tmp/issue9-fixture (HEAD ae73b66, dirty at revision 1)
  ```
  JSON: `"commit": {"head": "f512f5c3…", "sinceHead": 0, "dirty": false}`, `"head": "ae73b662…"`, `"dirty": true`, `"dirtyObservedAt": 1`. This held at every poll up to 22:41:04, and a later `squeal status --wait 60000` printed it again. `squeal why double` also shows `Revision: 1 · f512f5c3 + 0`. This matches the issue body (`4 · d13c7b57 + 0` beside `HEAD 3040cbf, dirty at revision 4`) and the comment (`3 · 1ba8356f + 0` beside `HEAD 3040cbf, dirty at revision 3`). I did not reproduce those exact sessions; my run shows the same shape.
- **Phase C, after `squeal stop`.** The header still reads `1 · f512f5c3 + 0`, with no `dirty` marker, which reads as clean. The Worktree line reads `HEAD ae73b66, dirty state not known: no daemon is validating`. JSON gives `commit.dirty: false` and `dirty: null`. The header asserts cleanliness that D7 says is not known without a daemon. The issue does not mention this.
- Cleanup: `squeal remove --config` removed the store, locks and temp dirs, the fixture directory was deleted, and no fixture daemon process remains.

**2. Why there are two identities** (read in source code, `a645f06e`).
- Top-level `head`, `dirty` and `dirtyObservedAt` come from `store.revisions.latest(worktreeId)` (`src/core/status/snapshot.ts:121-123`). With no revision, `head` falls back to `readGitHead(root)`. `dirty` is nulled when the daemon is not alive. The Worktree line renders these fields (`src/core/status/format-status.ts:276-284`). The type comment says "From the latest revision" (`src/core/types/status.ts:450`), but the JSON carries no such label.
- `commit` comes from `readRevisionCommit` (`src/core/state/revision-commit.ts`, called at `src/core/state/header.ts:65` and `src/core/status/why.ts:154`). That reader prefers the `headMoveMetaKey` record that `recordHeadMove` writes (`src/core/scheduler/head-move.ts`) when a pass makes no revision but `HEAD` has moved. It does not check daemon liveness.
- `recordHeadMove` runs only on non-watch batches (`src/core/scheduler/batch.ts:51-53, 80`), which in an idle daemon means the 30 s reconciliation pass (spec 001 D2, `spec.md:58`). A commit changes no work-tree bytes, so the watcher reports nothing and phase A lasts up to one pass interval.
- The 001-406 amendment (`spec.md:60`) says "a newer same-revision `HEAD` move decides the dirty flag". That was implemented for the commit display only. D7 (`spec.md:145`) still says the dirty flag "is the one observed at the last revision and is labelled with that revision; when no daemon is validating it is reported as not known". The two rules now describe two different fields that both appear on screen.

**3. Overlap** (read in board and status).
- 001-24 N7 put `HEAD` and dirty in status without a revision. That is the origin of top-level `head` and its git-dir fallback.
- 001-43 defect 7 labelled the dirty flag with its revision and made it unknown without a daemon. That is the Worktree line's current wording. The label keeps "dirty at revision 1" historically true, but `HEAD ae73b66` has no label and is now false.
- 001-406, reviewed in 001-417 (B4: A→B→A keeps the newer dirty flag; S2: the e2e header parser), added the head move. It routed the move through the header, `why` and JSON `commit`, but not through the Worktree line or the top-level fields. 001-24 S3's "one header reader" no longer holds for Git identity.
- No board row or review finding names this (searched `docs/board.md`, the `status.md` files and `reviews/` for the Worktree line, `dirtyObservedAt` and issue 9). Of the test files that touch the head move, the status tests reviewed here assert the header form and the Worktree line separately; I found none that renders both after a head move (inferred from grep, not exhaustive).
- **Claims in the issue.** Experiment reproduced the contradiction and the JSON fields. Source reading confirmed that JSON does not explain which field describes the checked files. The session numbers (`d13c7b57`, `1ba8356f`, `3040cbf`) and the cost of an extra Git check come from the reporter and I did not verify them. The issue's out-of-scope note (result validity for identical bytes) agrees with D2: results are keyed by content hash, so the passes at revision 1 hold at `f512f5c3`.

## Recommendation for Squeal

Take issue 9 as a small 001 row under D2/D7. Committing validated work is the normal end of an agent's task, so the contradiction appears at exactly the moment status is read to declare done. Three human decisions, each with the option I recommend:

1. **One Git identity on screen.** Recommended: the Worktree line and top-level `head`/`dirty` take the same reader as the header (`readRevisionCommit`, head move included). `dirtyObservedAt` says where the flag was seen. Alternatives: keep both and label the old one ("HEAD at revision 1") as the issue allows, or drop `HEAD` from the Worktree line, since the header carries it. Either way JSON should say in its field names or docs which identity is current and which is historical.
2. **The 30 s window (phase A).** Status could compare `readGitHead(root)`, a file read that status already uses, with the recorded `HEAD`. On a mismatch it would say `HEAD` moved since revision N and dirty is not known until the next pass, rather than show the old SHA as dirty. The alternative is to accept the window and document it. This window is where an agent that runs `status` straight after `git commit` lands.
3. **No daemon.** The header's dirty marker could follow D7's not-known rule, as the Worktree line already does (phase C).

Regression test, from the issue's acceptance: edit, wait, commit with no further file change, then assert text and JSON at once and after a pass, both with a daemon and without one.

## Open questions

- Delivery headers (hooks' `Revision N · sha + K`) use the same `readRevisionCommit`, so they should show phases A and C too (inferred). I exercised only CLI status and `why`, not hook headers in Claude Code or Codex.
- Not tried: a partial commit, an amend, or a checkout during phase A, or macOS. On Linux the pass interval decided the timing (about 26 to 31 s here at load average about 15).
- Whether (2) is in scope for issue 9 or a separate row is for the coordinator and the human.

## Sources

- Issue and comment: https://github.com/hearsay-tools/squeal/issues/9 (`gh issue view 9 --comments`, 2026-10-16).
- Experiment: `docs/specifications/001-core-loop/research/probes/issue-9-git-identity/` (throwaway; README and logs 0 to 4).
- Source at `a645f06e`: `src/core/status/snapshot.ts:87-125`, `src/core/status/format-status.ts:276-284`, `src/core/types/status.ts:170-180, 445-463`, `src/core/state/revision-commit.ts`, `src/core/state/header.ts:65`, `src/core/status/why.ts:154`, `src/core/scheduler/head-move.ts`, `src/core/scheduler/batch.ts:40-82`.
- Spec 001 `spec.md:54-60` (D2 and the 001-406 amendment), `spec.md:145` (D7 dirty flag); `status.md:263`; `docs/board.md` rows 001-24, 001-43, 001-406, 001-412; `reviews/wave-14.md` B4, S2.
- Vision `docs/vision.md:36, 52, 204, 213, 262-264`.
