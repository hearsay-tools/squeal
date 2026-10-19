# 011 wave 4 (2026-10-19)

Row 011-21, in the human's order: slice 1 now, slice 2 briefed after slice 1 lands. Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, `package.json` versions and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output; do not run `npm run build` in your tree. `run-reads-fidelity` and `observe-fidelity` fail under the Squeal daemon on main too (001-390); name them, do not fix them.

## W1: 011-21 slice 1, an edit's node:test or pytest tier starts beside the backlog tier

Use /worker. Shape: slice. Read board row 011-21, spec 011 C4 step 5 and the lanes paragraph as amended 2026-10-19 (`status.md`), C10 and C13, and `research/streaming-lanes.md`: findings 1 ("The sweep breaks") and 4 (b), and its Recommendation.

Outcome: while a node:test or pytest backlog tier runs, an edit's tier of that lane starts at once beside it, with no permit, and each run's escaped-process sweep stops only that run's leftovers. Vitest is unchanged: its edit still cancels the backlog tier.

Seams: the lane-busy rule in `src/core/scheduler/scheduler.ts` (`#inFlight`, keyed by lane; `selectTier`'s `busy` at :557) and `selectTier` in `tiers.ts`; the per-lane mark in `EscapedChildren` (`src/core/daemon/escaped.ts`, `mark`, `afterRun`). Lead: `research/probes/streaming-lanes/prototype.patch`, its `SQUEAL_PROTO_BESIDE` path and per-run mark, without the env switch. Whether a lane may run an edit's tier beside its backlog comes from the runner (Vitest no, node:test and pytest yes), not from a lane name test. A guarded source changes: raise `KEY_FORMAT_VERSION` to 15 and pin the hash `test/keys/key-format.test.ts` prints.

Owns: those files, the node:test and pytest adapter seams the patch touches, their tests, new tests under `test/scheduler/` and `test/daemon/`. Write `tasks/011-21/notes.md`. Slots are slice 2: leave the tier shape alone.

Done when, each red on main first where it can be:
1. A node:test backlog tier of 8 files of 2 to 6 s is running and an edit reaches a quick node:test file: its result is current within its own run plus 1 s, before the backlog tier ends, and every backlog file stores.
2. With an edit's tier beside the backlog tier, a backlog file whose input the edit changed is discarded and re-queued; the others store under their keys.
3. Two runs of one node:test lane overlap through `escaped.ts`'s wrapper and the first ends: the second's processes stay alive and its files complete.
4. A Vitest edit during a Vitest backlog tier still cancels it (the existing cancel test unchanged and green).

## W2: 011-21 slice 1, review of cand/0.1.224

Use /reviewer. Shape: review. Pinned to the `cand/0.1.224` SHA named in the spawn; the range is `origin/main..<sha>`: W1's two commits, the release commit (version 0.1.224 and the bundles) and this brief.

Read W1 above, spec 011 C4 step 5 and the lanes paragraph as amended 2026-10-19 (`status.md`), C10 and C13, `research/streaming-lanes.md` (finding 4 (b), Recommendation) and `tasks/011-21/notes.md`. Check that:
- `busyLanes` frees a lane only for an edit's tier beside a lone backlog tier of a runner whose `besideBacklog` is true; never two backlog tiers, never beside an edit's tier, never for Vitest; the tier then selected is an edit's, with no permit;
- the scheduler's `#inFlight`, now keyed by run id, keeps every lane, slow-lane, idle and departure rule it had;
- a backlog file whose input the edit changed is discarded at record and re-queued, the rest stored;
- the per-run sweep mark (`escaped.ts`) stops only its own run's leftovers, the lane-wide mark is unchanged for Vitest, and the overlapping-run naming still holds;
- `besideBacklog` passes through every wrapper (composite, recovering, slow instance, sweep), and `KEY_FORMAT_VERSION` 15 is right against the released 14.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; a file that fails loaded and passes alone is named. Write `reviews/wave-4.md` with a PASS or FAIL verdict and commit it.
