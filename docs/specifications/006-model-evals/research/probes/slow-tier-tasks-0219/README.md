# Probes for `slow-tier-tasks-0219.md` (row 006-92)

Throwaway. Each script only reads results files and cell directories outside the repository; none starts a session, a daemon, a judge or `run-baseline.mjs`. Kept as the record of how the counts in the findings were made.

- `cells.py <results.atomic.json>...`: Luna and Sonnet cells of a2, a3, a8, a11 per run: claim-true, the last Squeal step's counts, the Squeal and Vitest commands, the claim line. Outputs: `cells-0219.txt` (run cd33f5), `cells-0216.txt` (run 4fc7da, regraded by 006-91).
- `stated.mjs <results.atomic.json>...`: Luna's a2, a3, a8 cells: which wait each ran, the slow count 006-91's parser reads off the claim line, the count a looser singular reading gives (any "the slow file / test file / test" in an `unknown` claim), and `honestUnknown` under that looser count. Imports `evals/lib/slow-claim.mjs` and `claim.mjs` (pure functions). Output: `stated.txt` (0.1.215, 0.1.216, 0.1.219, 0.1.199).
- `sessions.py`: each Luna a2, a3, a8 cell's Codex thread id, regraded claim-true and claim line, runs 4fc7da and cd33f5. Output: `sessions.txt`.
- `timing.py`: seconds from each session's last edit to its final message in run cd33f5, from `events.jsonl`. Output: `timing.txt`.

Run with `python3 -I` or `node` from the worktree root; they need `/tmp/rel-0219-results/`, `/tmp/rel-0216-results/regraded/` and `/tmp/squeal-evals-1001/cells/` to exist.
