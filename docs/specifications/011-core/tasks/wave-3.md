# 011 wave 3 (2026-10-19)

One row, the research 001-366 asks for before its code. Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, `package.json` versions and `plugins/*/dist` to the coordinator. No product code.

## R1: 001-366, what a backlog tier's budget should bound when its files run in parallel

Use /researcher. Shape: research. Read the board row 001-366 (under Feature 011; it kept its 001 number at the split), spec 011 C4 step 5 and C10 Capacity, `../005-agent-adoption/lessons.md` proposed row 5, and `src/core/scheduler/backlog.ts`, `tiers.ts` (`selectTier`), `claims.ts` (`backlogSize`), `src/core/capacity/pool.ts`.

Outcome: a recommended budget rule, sized by the tier's expected wall time under the workers it will run with, and the interrupt-latency cost of it, with numbers.

Evidence the human saw on 2026-10-19 (cezar main daemon, 0.1.222, load 3 to 5 on 24 CPUs): a `run --all` tail ran tiers of 200, 163, 71, 36, 18, 9, then 7 to 2, then one file each (136 to 504 s), one fork busy, about 16 % of one CPU.

Questions:
1. Which latencies the 300 s serial budget bounds today, per runner: an edit's tier behind a backlog tier (Vitest's cancel, node:test's run to the end, pytest), a departing daemon waiting for its tier (D10), results stored only at tier end, a tier meeting `runner.timeoutMs` (001-179's split).
2. The grant is taken after the files are picked (`capacity.take(picked.length)`). Can the selection know its worker count first (the fair share, the project's `maxWorkers`, the floor of 2)? Which estimate of wall time holds, for example the longest file or the sum over workers, whichever is larger?
3. Measure today's rule against a prototype rule on a synthetic fixture of heavy, mostly idle test files (60 to 150 s, one Vitest and one node:test project): time to finish the backlog, and the delay of an edit landing mid-tier in each runner. A cezar scratch clone is optional, only below load 8 on 24.

Isolation: scratch clones by commit SHA, a scratch `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and store, never the real pool directory or a real session. Hold measurements while the one-minute load is above 8 on 24 and record the load beside every number. Related, out of scope: 001-381 (an edit splits a running backlog tier).

Owns: `docs/specifications/011-core/research/backlog-wall-budget.md`, `docs/specifications/011-core/research/probes/backlog-wall-budget/`.

Done when: the findings file answers 1 to 3 under the findings rules of `../001-core-loop/research/README.md` and ends with the rule, the C4 step 5 sentences it changes, and a slice's done-when as tests.
