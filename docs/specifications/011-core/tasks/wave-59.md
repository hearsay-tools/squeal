# Wave 59: row 011-267 (research: a named wait runs as its own batch)

Coordinator 81e2c6a1, 2026-10-29. One row, research only. Host policy (2026-10-25): no local full suite, no `squeal run --all`; every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; private `/tmp` fixtures only; never make CPU load on purpose; no real cezar or parity test runs. No `pnpm run build`. Not yours: the board, spec text, `status.md`, `src/`, bundles, version.

## R1: row 011-267

Use /researcher. Shape: research.

Outcome: a recommendation, with replayed numbers, on whether a named wait should run as one wide batch ahead of all other work, later waits queued after it in order (then edits, then catch-up), as the human proposes; or what order does better.

Read: the board row 011-267 and rows 011-265, 011-266, gh-125; `research/issue-79-gate.md`, `research/issue-125.md`; spec 011 C4 steps 4–5, C10, C15.

Evidence: two real traces in cezar's store, read-only (`/home/agent/projects/cezar/.git/squeal/store.sqlite`, table `runs`, per-file durations in each `log_dir/report.json`; open with `node:sqlite` `readOnly`): 0.1.374, worktree `fc6636c99e616927`, 01:22–02:28 UTC; 0.1.377, worktree `aa38987337df8e1f`, 09:29–10:02 UTC, its worker's record at `/home/agent/projects/cezar/.ai/cezar/worktrees/563b3d1c-f5b8-46ee-b702-a8feb6d1e143/.ai/qa/2141/squeal-trial.md`. Seam to start from: `selectTier` (`src/core/scheduler/tiers.ts`), `Queue.ordered` (`queue.ts`), and the issue-79 probe (`research/probes/issue-79/gate.probe.ts`) as a replay harness.

Answer: (1) each candidate order replayed on both traces: time to the wait's last verdict and to the edit's own files; (2) longest-first against shortest-first, and one batch against per-file slots, inside a wait; (3) an edit during a wait's batch: cancel, run beside it, or wait; and which revision the wait follows; (4) a one-file wait behind another session's 56-file batch in the same worktree; (5) wait streams, overlapping waits, re-waits after a deadline (011-266 S3); (6) whether this replaces gh-125 and 011-266.

Done when: `research/named-wait-batches.md` committed with a verdict and evidence tag per question, the C4 and C15 sentences that would change, and a slice's done-when as tests; probes under `research/probes/011-267/`.

## W1: rows 011-268 then 011-269 (a named wait's batch, and work beside it)

Use /worker. Shape: slice, two commits, one per row, in order; they release together.

Outcome: a 56-file named wait in cezar gets its verdict in about 6 minutes at 11 workers, while an edit's own files and a small later wait still get results in seconds.

Read: the board rows; `research/named-wait-batches.md` (Recommendation, the C4 and C15 sentences, the seven done-when tests); spec 011 C4 steps 4–5, C10, C15; `tasks/011-265/notes.md`; `status.md` 2026-10-28 and 2026-10-29 lines.

011-268 (tests 1, 2, 5's second half, 6, 7): a wait's queued files form one batch that lasts until each is current or re-keyed, not until the deadline; batches run in request order, one tier at the whole grant, no wall budget, longest first; with backlog queued, one backlog tier after each batch tier. Seam and lead: `promotedOnly` (`src/core/scheduler/promoted-tier.ts`) and its call in `selectTier` (`tiers.ts`); the order in `Queue.ordered` (`queue.ts`). C4's timeout split still applies.

011-269 (tests 3, 4, 5's first half): an edit's tier, and a later wait of at most 30 file-seconds, start beside a running batch tier in a second Vitest instance, up to `runner.tierSize` workers above the grant; no cancel of the batch for an edit unless every unfinished file is re-keyed. Seam and lead: `withSlowInstance` (`src/runners/vitest/adapter.ts:742`) and `width.ts` for the instance pattern; the lane's busy rule in `tiers.ts`.

Owns: `src/core/scheduler/`, `src/runners/vitest/adapter.ts`, `width.ts`, the status text and JSON for the wait's batch line, their tests, `tasks/011-268/notes.md`. Leave alone: the board, spec, `status.md`, bundles, version, other runners. Ask me before changing yields (`yields.ts`, `yield-sooner.ts`) or the pool (`src/core/capacity/`).

Done when: the research's seven tests, red before; existing scheduler and Vitest-adapter tests pass or each changed setup is named in the notes; the notes give the final C4 and C15 sentences; lint and typecheck pass; affected results read with `squeal status --wait 60000 <paths>`.
