# Wave 21.5: repair of `cand/0.1.483` (review `reviews/0.1.483.md`: FAIL)

Base: worker cdd2fb40's own branch (`cez/cdd2fb40`); the coordinator cherry-picks the repair onto the candidate (`w21/land`). Same check rules as `tasks/wave-21.md`.

## R1 (row 020-57, B1)

Use /worker. Shape: repair. Read `reviews/0.1.483.md` B1, its live control, output and "One-worker fix".
- The setup warning's suppression (`loadedSetupFiles`) reads the selection before the fit, so when the load-scaled estimate makes the early stop skip every file of the setup's project, the true "will read incomplete (no-loader)" line is dropped and the report then ends `incomplete`, `no-loader` with no early warning. Give the suppression the fitted run plan and the reusable evidence: drop the line only when the setup's own project still has a file scheduled to run, or reused evidence (stores or parts) measures the setup.
- Keep the selection counts, the setup-selection line, the early-stop rule, verdicts, exit codes and policy version. Keep the estimate and selection lines before any setup or prepare runs.
Owns: `src/core/code/gate/{prerun,setup-selection,collect,plan}.ts`, `src/cli/code-gate-prerun.ts`, their tests.
Done when (tests, through collection or the CLI): a setup-only edit with 20 known durations at a simulated load that moves the estimate past the early-stop threshold keeps its no-loader line when no file runs or is read; a surviving `--test` file or a reused record that measures the setup still drops it; config and global setup lines remain.
