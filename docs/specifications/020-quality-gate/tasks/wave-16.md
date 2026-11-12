# Wave 16 (the human, 2026-11-13: budget rows "Build all three"; early stop "Stop early")

Base: `w16/base` at `ca51db505594b0b5c309ed1cb736043e1edf4bdf` = main plus row 020-40's commits (the kept failed-run log; it lands first as 0.1.461 with row 020-39). Read `research/gate-budget.md` (probes starve, control, long, hooks; the rule model; open questions), `research/issue-196.md`, `research/issue-198.md`, spec D3.4, D17, D18. Host load is high: targeted tests only, live probes only below load 24. Row 020-39 (worker 58e6f8c1) owns `keep*.ts` and `src/core/run-evidence/**`; leave those alone.

## 020-44 and 020-43: runners at once, and the files using the budget (#196)

Use /worker. Shape: slice.
- 020-44: the gate runs Vitest and node:test at the same time, as the daemon does, with one shared pool for the node:test entries; it never stops a running file to make room; within a runner, D17.2's order stays. D18 changes from "one runner after another" to this (write the proposed D18 text in your notes). The starve probe's shape (60 s node:test file, 25 s budget) must let every other runner's files finish.
- 020-43: while the gate runs, stderr names the files that run past their estimate (Vitest's `onTestModuleQueued` gives a per-file start; node:test has its own file start), and the report tells started-and-stopped files apart from never-started ones (`runs[].notStarted` beside `notFinished`, or equal; say which).
Owns: `src/core/code/gate/{collect,runs,runners,runner-order,evidence,report,types}.ts`, the gate's runner adapter hooks under `src/runners/vitest/**` and `src/runners/node-test/**` only for a file-start callback, `src/cli/code-gate.ts`, their tests.
Done when (tests): the starve shape finishes the other runners' files within the budget; a file running past its estimate is named once; the report separates started from never-started; verdict rules and `QUALITY_POLICY_VERSION` unchanged.

## 020-45 and 020-46: over budget, one rerun command, and the early stop (#196, #198)

Use /worker. Shape: slice.
- 020-45: when the D17.1 estimate exceeds the budget, stderr and the report name one rerun command with a fitted `--timeout` (and, where they fit, the path or `--group` arguments).
- 020-46: when the estimate is at least 2x the budget, the gate stops early before the selected files that load no changed function (for example files selected only because a file their config imports changed, #198), runs the rest, and the report names what it skipped and the rerun command. Those files read not run, so their functions stay as the rules say (never a pass from skipping). D17.1's "the run always starts" changes: write the proposed D17.1 text in your notes.
Owns: `src/core/code/gate/{estimate,plan,order,prerun}.ts`, `src/cli/code-gate-prerun.ts`, their tests; add report and type fields in their own small commit (worker 020-44/43 owns `report.ts` and `types.ts`; I resolve overlaps).
Done when (tests): an over-budget run names a rerun command whose timeout fits the estimate; at 2x or more, non-loader files are skipped and named, loader files run; under 2x nothing is skipped; verdict and exit unchanged otherwise.
