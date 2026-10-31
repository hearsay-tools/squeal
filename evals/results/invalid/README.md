# Results kept out of the trend

A results file here is kept as evidence and read by no generator or test: `atomic-trend.mjs`, `trend.mjs` and the tests read only the files directly in `evals/results/`.

- `2026-10-31-0.1.387.20261031T221020Z-ec45fb.atomic.json` (atomic run on 0.1.387, Sonnet and Sol; coordinator 6e3bce1c, 2026-10-31). Its Codex half is invalid: since 0.1.368 (`e34c9bc1f`) the Codex CLI is in `plugins/codex-runtime`, and `evals/bin/run-cell.mjs:199` still loads `plugins/codex/dist/cli/squeal.mjs`, so no Codex cell reached a daemon (0 of 100), and the 10 `a11-inherited-flake` Sol cells failed in setup. The six Sol flags it raised were the missing CLI, not Squeal. Its Sonnet half (110 cells) was valid: no alarm, no flag. Moved here because the scored run broke `test/evals/atomic-trend.test.ts` on main. Board row 006-100 fixes the harness; the run is repeated after it lands.
