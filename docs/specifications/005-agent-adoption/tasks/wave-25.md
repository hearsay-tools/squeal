# 005 wave 25: a served delivery that writes many rows is not quadratic; Stop lists the states once

Rows 005-123 and 005-124, from `research/boundary-hook-cost.md` (ranks 1 and 3). The human chose them on 2026-11-17 in task cfa29290. Coordinator: session 4d2ecbfc. Two workers, disjoint.

Rules for both: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report (`squeal status --wait 60000 <path>...`); the three bundle tests fail on drift until the coordinator builds, which is expected. Run a Vitest file directly only where Squeal does not cover it, one at a time, `timeout 900`. Write `~`, never a `/home/<user>/` path. Never run a script under `evals/bin`. No artificial load; a timing names the host's load at that time.

## W1: 005-123, the pending overlay is built only for a meta read

Use /worker. Shape: slice. Outcome: while a daemon serves, a hook's read through `SendingConnection` costs the same whatever the size of the batch it holds, unless the read is a `meta` read.

Evidence: `research/boundary-hook-cost.md`, section 2, point 1. Every `get` builds `[...held, ...batch]` (`#pending()`, `src/core/delivery/sending-connection.ts:138` and `:256`) before `overlaidMeta` checks whether the read is a `meta` read; `findCheckId` makes one `get` per state while the batch grows: 5.4 s of a 9.2 s delivery, quadratic. The researcher's scratch copy with the overlay built only for a `meta` read cut the served first delivery from 8.3 to 9.5 s to 1.79 s on a copy of a large store, and from 2.4 to 3.0 s to 0.85 s here.

Contract: no read returns a different value than today (the overlay's meaning is spec 021 D15: a hook reads its own pending meta writes). Check `all` and every other read path of the class for the same order of work, and `src/core/delivery/prepared.ts`.

Owns: `src/core/delivery/sending-connection.ts`, `prepared.ts` if the same pattern is there, their tests. Leave alone: `src/core/daemon/**` (the write desk is another coordinator's row), `src/core/delivery/{delivery,delta,counts-owed}.ts` (row 005-113).

Done when: a test that counts the overlay builds (or the statements scanned) for N non-meta reads with a batch of M statements and fails on main as M x N; the existing overlay tests pass unchanged; a timing of 30,000 `get` calls against a growing batch before and after, in `tasks/005-123/notes.md`.

Final message: the commit, the count and timing before and after, check results.

## W2: 005-124, Stop lists the states once

Use /worker. Shape: slice. Outcome: one Stop hook reads the worktree's known states once and the code states once, not three times.

Evidence: `research/boundary-hook-cost.md`, section 3 and rank 3: the known states with checks cost 186 to 250 ms SQL and about 50 ms decode per read on a copy of a large store, and Stop reads them three times (its news, its decision and the turn end); Stop takes 1.32 s there as a hook, against a 2 s limit, and 40% of that repository's turns end with a cancelled Stop. Expected about 0.8 s (inferred).

Contract: no Stop text and no Stop decision changes. A read inside a write transaction that must see that transaction's own writes stays correct: say for each of the three reads whether the states can change between them inside one Stop, and why one read is still right. If one read cannot serve all three without a behaviour change, stop and report.

Owns: `src/harness/shared/stop.ts` and the Stop path it calls for these reads (`stop-decide.ts`, `stop-required.ts`, `stop-slow.ts` only where a states list is passed in), `src/core/delivery/turn.ts` if `endTurn` takes the list, their tests. Leave alone: the `readLiveHeader` calls in the stop files (row 005-115 changes them later), `src/core/delivery/{delivery,delta,counts-owed}.ts` beyond a parameter (row 005-113 owns them: ask the coordinator before you change a signature there), `src/core/presence/**`, text.

Done when: a test that counts the states reads of one Stop (1, on main 3) for a quiet Stop, a Stop with news and a Stop that blocks; every existing Stop test passes unchanged; a timing of the three Stop kinds at 30,000 synthetic states before and after in `tasks/005-124/notes.md`.

Final message: the commit, the read counts and timings before and after, check results.
