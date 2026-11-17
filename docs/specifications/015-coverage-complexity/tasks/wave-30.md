# 015 wave 30: complexity news reads once, on partial indexes (row 015-127)

Coordinator: session cfa29290. The human approved it 2026-11-17 (rank 5 of `../../005-agent-adoption/research/boundary-hook-cost.md`). Use /worker.

## W1: row 015-127

**Outcome.** A tool-boundary hook reads the worktree's failing and edited code states once, on partial indexes, instead of three times by primary-key scan: about 145 ms off each cezar boundary, 50 ms in squeal.

**Read.** `boundary-hook-cost.md` table row "Code: failing and edited states" and its probe `probes/boundary-hook-cost/code-reads.mjs`; spec 015 D4 ("An additive table after version 1"); `CODE_INDEXES` in `src/core/code/store/schema.ts` (rows 015-44, 005-103 added indexes this way).

**Shape.** Slice.

**Seam.** `src/core/code/store/states.ts` `list`: `(? IS NULL OR s.measure = ?) AND (? IS NULL OR s.outcome = ?)` hides each filter from the planner. First edit: build the SQL with only the predicates the filter names. Then add partial indexes to `CODE_INDEXES` (additive, no `user_version` raise) that the failing and edited reads use; prove the plan with `EXPLAIN QUERY PLAN` in a test. Then make `tellCode` (`src/core/delivery/code-deliver.ts`) read each set once per hook and pass it to the steps that read it again.

**Owns.** `src/core/code/store/{schema,states}.ts`, `src/core/delivery/code-deliver.ts`, their tests. **Leave alone:** `src/core/delivery/delivery.ts` (005-113), `sending-connection.ts` (005-123), the Stop path and `stopTurn` (005-124), `src/core/daemon/write-desk.ts` (011-393). If reading once needs a change in one of them, stop and ask the coordinator.

**Done when.** Tests: the plan of each read names its index; the same states and news as before on a fixture; an older store without the indexes still reads. Timings on a copy of a large store, before and after, with the host load stated (copies only, never a live store or a real session id). Affected checks via `squeal status --wait 60000 <paths>`; lint and typecheck. No version raise and no bundle build: the coordinator does both.
