# Spec 021, wave 9: after the week-after measurements

The human, 2026-11-19, on coordinator 585446dc's card: 021-33 "Yes"; 021-34 "Run the design, but also let me know what you'd how that would improve" (one daemon per project = per clone: all worktrees of one repository); the 6 test slots on this host were meant "to manage the workload", not to cap background work at 6 busy CPUs (that rule is gh-225, spec 011). Evidence: `research/one-daemon-gate.md` (021-17), `research/cpu-ceiling-measured.md` (021-19). The two rows run in parallel: 021-33 is code, 021-34 is a design file only.

## 021-33: prune once per clone, search outside the write lock

Use /worker. Shape: slice.

Outcome: a clone prunes its shared stores once per interval, not once per daemon, and no prune slice scans a table while it holds the write lock.

Read: `research/one-daemon-gate.md` Q3 and Q5; spec D3 (sliced writes, the 250 ms long-write line); `../011-core` row 011-350 (#220) for why slices exist.

Seam: `src/core/daemon/lifecycle.ts` (the prune timer, lines about 435 to 475), `src/core/daemon/sliced-prune.ts`, `src/core/code/store/prune.ts` (`pruneCodeSlices`, the `DELETE ... WHERE key IN (SELECT ... LIMIT ...)` at about line 235), `src/core/store/prune.ts`, `src/core/store/loaded-modules.ts` (`dropOrphanLoadedModules`). First edit, offered as a lead: in each slice, select the candidate keys in a read (no write transaction), then delete by those keys in the write transaction with the condition tested again per key. For once per clone: a per-clone "last pruned" mark in the store, or a lock file under `<commonDir>/squeal/`; a daemon skips its prune when another pruned within the interval. Your choice; say why in `tasks/021-33-notes.md`.

Owns: the files above, their tests, `tasks/021-33-notes.md`. Leave alone: `src/core/capacity/` (gh-225, spec 011), `docs/board.md`.

Done when: tests show (1) a slice that deletes nothing takes no write lock or holds it only for the keyed delete; (2) two daemons on one clone prune once per interval; (3) a row that stops matching between the read and the delete is kept. A probe on a copy of cezar's stores (`~/projects/cezar/.git/squeal/{store,code}.sqlite` copied under `$TMPDIR`, never the live files) shows prune holds under 250 ms. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No full suite. Run any direct Vitest with a timeout; leave no orphan processes. Do not run `pnpm run build`.

## 021-34: design, one daemon per project (per clone)

Use /worker. Shape: survey and design (no product code).

Outcome: `tasks/021-34/design.md`, a design the human can approve or reject, that states what one daemon per clone improves, measured or computed from today's evidence, and what it costs.

Read: `research/daemon-model.md` (Q2 (a), Q4, Q6 step 5, Q7), `research/one-daemon-gate.md`, `research/store-contention.md`, `research/cpu-ceiling-measured.md`, `research/daemon-heap.md`, `../../011-core/research/daemon-scope.md` (011-52: why it was rejected in October), spec D8, D15, D16, D18, D20, D21. Runner hosts as separate processes shipped (D20); check what still runs inside the daemon.

Answer, with numbers from those files or from a read-only look at live daemons (`/proc`, `squeal ps`, the daemon logs; open no socket, signal nothing, make no load):
1. What it improves: lock waits between daemons (10.1% / 8.8% of main-thread samples today), prune and other repeated per-daemon work, memory per worktree (daemon without runner hosts against 011-52's numbers), one scheduler and one CPU budget across worktrees, edit-tier priority across worktrees.
2. What it costs or risks: blast radius of one crash or hang, mixed Squeal versions across worktrees, per-worktree config and environment, event-loop load of N worktrees in one process (daemon-model.md: 0.5 to 1.0 core of main thread per busy cezar worktree), harness delivery.
3. What changed since 011-52 rejected it, and what would make the human's earlier push right or wrong now.
4. The process model and interfaces in outline, the migration in steps that each ship alone, and the smallest first slice.
5. Alternatives that reach the same gain with less change (for example a store broker per clone, daemon-model.md Q2 (b)), compared on the same numbers.

Owns: `tasks/021-34/`. Leave alone: everything else, `spec.md` included (the coordinator amends it after the human's decision). Done when the design file is committed, 2 to 5 pages, with a one-paragraph summary at the top in plain English for the human.
