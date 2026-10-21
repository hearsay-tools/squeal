# 011-82 brief: design, a burst of revisions does not restart large batches

The human, 2026-10-21, from the host-load review (`research/host-load.md` 4). Spec text now; code rows after the human accepts the design.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-82/design.md`, which the human can accept as an amendment to 011 C4 step 5 and its checkpoint paragraph.

Read: the board's 011-82 row; `research/host-load.md` 4; 011 C4; `research/backlog-wall-budget.md` and `research/catch-up.md`; `src/core/scheduler/tiers.ts` (the cancel at about line 96), `claims.ts` (`backlogTierSize`), `queue.ts`, `store-decision.ts` (the superseded discard at about line 130).

Answer, each with a recommendation:

1. **Where the work goes.** From both stores, read-only: in a cancelled backlog tier, how many files had ended and were dropped, how many never started, and how many kept their key at the new revision. Explain the 167 s batch at revision 28 of `716a6766` that stored nothing, or say why it cannot be explained.
2. **Options.** Keep a cancelled tier's finished files whose key still holds; cancel only when the edit reaches the tier's files; a quiet period after the last revision; a tier that grows with the time since it. What each costs in time to an edited file's verdict, against C4's budgets.
3. **Measure.** The share of picked files that store a result, today and expected, on the 24-hour numbers in `host-load.md`.

## Rules for every host-load design

Include the spec text as drafts, the rejected options, and the decisions for the human at the top (as `tasks/011-62/design.md` does). Name each code row in order with its seam, owned files and the tests it lands red first. Four host-load designs run at once (011-82, 011-83, 011-84, 011-85): if a code row of yours touches another one's seam, say so.

Owns `tasks/011-82/` only, probes under `tasks/011-82/probes/`. Leave alone: spec, status, board, product code, other rows' folders.

The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal a process. Probes run in a `git clone` under `/tmp` (never `git worktree add`: it shares the live store), with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`; a scratch daemon uses `baseline.onStart: lookup-only`, no slow lane, at most 4 test workers. No build. Remove your clones at the end. Record the one-minute load beside every timing.

Test runs: run single test files only. A full-suite verdict, if a probe needs one, is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your notes.

Done when `design.md` is committed. Stop at the human's dated acceptance.
