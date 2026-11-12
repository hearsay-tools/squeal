# Wave 14 (the human, 2026-11-12: 020-39 "Build it"; #196 "Research first"; #197 "Keep the log file"; #198 "Research both")

Base: main at the commit that adds this file. Host load was 88 on 24 CPUs at dispatch: targeted tests only; live probes only below load 24. Row 020-39 waits for spec 011's row 011-320 (coordinator bef76bfb, in repair as 0.1.458), which edits `keep-write.ts`, `keep.ts`, `keep-expected.ts`, `stored.ts` and `src/core/run-evidence/**`; no row here touches those.

## 020-40: a failed gate run keeps its log (#197)

Use /worker. Shape: slice. Read `research/issue-197.md` and spec D3.4, D3.5, D5, D7.
Outcome: when a selected test file fails (or does not finish) in `squeal code --base`, the run's log for that runner (the adapter's per-test output, error messages, stacks and child output it already writes) is kept instead of removed with the temporary directory, and the report names its path: one stderr line after the verdict, and a JSON field per run (`runs[].log`). A run with no failure keeps nothing, as today.
Find out first how the daemon keeps its run logs (`runs.log_dir`, `report.json`, their retention and prune) and reuse that place and retention for the gate's kept logs, so one prune rule covers both; say in your notes what you chose and why. Never keep logs inside the project's tracked tree.
Start: `src/core/code/gate/collect.ts` (the `finally` that removes the temporary directory, about line 206) and `report.ts` (failed entries, about line 150).
Owns: `src/core/code/gate/{collect,report,types,runs,evidence}.ts`, `src/cli/code-gate*.ts`, their tests, the three `commands.md` copies. Leave alone: `keep*.ts`, `stored.ts`, `src/core/run-evidence/**`, `src/core/store/*` (read only), runner adapters except to read where they write logs.
Done when (tests): a failing and an unfinished file each leave a log whose path the report names, plain and `--json`; a passing run keeps nothing; the kept logs fall under the existing prune; JSON stays one object on stdout; verdict and exit unchanged.

## 020-41: the gate's time budget across runners (#196, #198 part 2)

Use /researcher. Read `research/issue-196.md`, `research/issue-198.md`, `research/wide-import.md`, spec D3.4, D17, D18. Questions: (1) when the first runner's files exceed its estimate, what bounded rule lets later runners still produce evidence (a share per runner, interleaving, a per-file cap) and what each costs and risks; (2) when the estimate is clearly over the budget before any run, what an early outcome should say and what supported command it should name, against today's "the run always starts"; (3) how to name the file that is consuming the budget while it runs. Probes in `/tmp` with their own HOME, below load 24. Write `research/gate-budget.md`; propose rows, no spec text.

## 020-42: narrower selection for files the Vitest config imports (#198 part 1)

Use /researcher. Read `research/issue-198.md`, spec 001 D3/D4 (environment hash), spec 020 D3.1. Question: when a changed file is only in the root Vitest config's `configFileDependencies` (a sequencer, a reporter, a setup helper), can the gate select fewer than every test file without a false pass? What evidence would show which tests the file affects, what the daemon does with the same edit (it re-keys every check), and whether gate and daemon must agree. Probes in `/tmp`, below load 24. Write `research/config-dependency-selection.md`; propose, do not decide.
