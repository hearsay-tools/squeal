# 011-30 brief: design, a daemon upgrade hands its work over

Approved by the human on 2026-10-20 (triage gh-47, "design row"). Spec text now; code rows after the human accepts it and after 011-22 lands.

Use /worker. Shape: survey, a design draft for the human. Outcome: `tasks/011-30/design.md`, which the human can accept as amendments to 011 C9 (and C4, C6 or C8 where touched).

Read: the board's 011-30 row; 011 C4, C6, C7, C8, C9 and `status.md`; `research/issue-47.md` with `research/probes/issue-47/`; rows 001-436, 011-08 and gh-27. Seams, read only: `src/core/daemon/daemon.ts` (`#shutdown`, `#cancelTiers`, the step-down handler), `src/core/daemon/handlers.ts`, `src/harness/shared/ensure.ts` (`stepDownIfOlder`, `successor`, `SUCCESSOR_LOCK_WAIT_MS`), `src/cli/start.ts`, the scheduler's start scan under `lookup-only`.

Answer, each with an evidence tag and one recommendation:

1. Step-down: cancel the running tier as `stop` does, or wait with a bound; what a cancelled tier keeps (finished files' results) and re-queues for the successor; how 011-21's lanes and slots and 011-22's catch-up change it.
2. One successor per worktree: how concurrent hooks converge on one spawn.
3. Pending work: how the successor learns the queued and edited files under `lookup-only` (findings 4 and 5: they went stale), and why run 5's file went stale.
4. `start` and `status` name a handoff phase consistently (socket ping against heartbeat), with a recovery command when the handoff cannot finish within its bound.
5. The code rows: seams, owners, and the regression from the probe's shape (an edit's tier held across a step-down, six hooks, the bound, a `lookup-only` restart).

Include spec text as drafts and the rejected options. Out of scope: gh-27's session-end lifecycle, 001-436.

Owns `tasks/011-30/` only, probes under `tasks/011-30/probes/`. Leave alone: spec, status, board, product code. Probes reuse `research/probes/issue-47/` in a throwaway repo under `/tmp` with `HOME` and `XDG_*` there, only while the one-minute load is below the CPU count; no full suite, no build. Done when design.md is committed. Stop: the human's dated acceptance.
