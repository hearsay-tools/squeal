# Wave 21 (the human, 2026-11-14, on the #212 research: "A: Fix the messages")

One row, from main. Read `research/issue-212-setup.md` (findings 1 to 5, the recommendation, open question 2) and issue #212. No change to what `pass` means, no verdict or exit-code change, no `QUALITY_POLICY_VERSION` raise. Check rules as in `tasks/wave-20.md`: targeted tests only, no full suite, no `pnpm run build` in a worker tree. Notes in `tasks/wave-21-020-57/notes.md` with proposed spec text (D3.4, D14, D17.1).

## 020-57: the gate's early lines tell the truth about a setup-file change and a busy host (#212)

Use /worker. Shape: slice.
- **The false line.** Before the run, a change to a Vitest `setupFiles` entry prints that its functions "will read incomplete (no-loader)", and both claims are false: every test file of the project runs the setup file, and its functions pass from any completed file. `unloadedPaths` (`src/core/code/gate/prerun.ts:207`) reads only test files' imports. Count a project's setup files as loaded by that project's selected files.
- **A setup-selection line.** When a changed path is a setup file (or another path every test file of a project loads) and so selects the whole project, say so in one line before the run, with the count and the estimate against the budget.
- **A load-aware estimate.** The D17.1 estimate assumes the host is free. Scale it by the host's one-minute load per CPU when that is above 1 (the same `hostLoad` the daemon and row 020-54 use), and say on the estimate line that it did. The over-budget line, the rerun command and the early stop then follow the scaled estimate. Keep the unscaled number in the report beside it if a report field is needed; a new `RunReport` field needs its rule in `src/core/daemon/report-merge.ts`.
- First edit, as a lead: `unloadedPaths` in `prerun.ts`, then the estimate in `estimate.ts` (`estimateAll` near 99).
Owns: `src/core/code/gate/{prerun,estimate,plan}.ts`, `src/cli/code-gate-prerun.ts`, the gate's report types only for an estimate field, their tests. Tests that need a load use the host-load seam from row 020-54 (`test/code/gate/host-load.ts`), never real load.
Done when (tests): a setup-file change prints no no-loader line and does print the setup-selection line; at a simulated load of twice the CPU count the estimate doubles and the over-budget line, rerun command and early stop follow it; below the CPU count nothing changes; verdicts and exit codes unchanged.
