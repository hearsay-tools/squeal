# Benchmark for candidate 0.1.576 (rows 011-417, 011-418, 011-419)

`docs/process.md` step 6c. Cells `ref`, `wt-3` and `load-50`, boat.dev `default` sandboxes, both runs on AMD Ryzen 9 9950X, 2026-11-20. Base: main `c078de900` (0.1.575), the commit the candidate starts from; not the last release 0.1.572, so that row 021-36 (0.1.575) does not enter the comparison. Candidate: `87c35a26f` (`cand/0.1.576`). One run each; the benchmark's run-to-run noise is not measured yet (README "When to run", item 4). Results: `bench/results/2026-11-20-0.1.575-default-AMD-Ryzen-9-9950X-16-Core-Processor/` and `.../2026-11-20-0.1.576-.../`.

Runs: `env TMPDIR=/tmp bash bench/boat-run.sh --ref <sha> --cells ref,wt-3,load-50`. Without `TMPDIR=/tmp`, a Squawk session's `TMPDIR` lies in the repository (gitignored) and `boat push` copied 0 files; the bench owner was told.

| Cell | 0.1.575 | 0.1.576 | Change |
|---|---|---|---|
| ref | 78 | 68 | -10 |
| wt-3 | 70 | 60 | -10 |
| load-50 | 56 | 64 | +8 |
| Overall | 68 | 64 | -4 |

Correctness passes in every cell of both runs. No cell drops 15 points.

Metrics that moved (base → candidate; ref / wt-3 / load-50):

- Daemon CPU with no edits: 0.8 / 2.5 / 2.4 → 1.3 / 4.9 / 1.3 % of a core (ref crosses the 1% healthy limit).
- Store writes holding the lock over 250 ms: 0 / 3 / 4 → 2 / 7 / 3.
- `squeal status` p95: 156 / 255 / 291 → 173 / 392 / 181 ms.
- Full run with Squeal against plain Vitest (load-50): 1.81x → 1.52x; full run time 82 s → 60 s (ref 39 → 43 s, wt-3 37 → 61 s).
- Edit of every test's import until all current: 156 / 177 / 234 → 165 / 163 / 231 s.
- Daemon peak memory: 537 / 514 / 525 → 484 / 477 / 455 MiB.
- Hooks and edit-to-verdict medians: within a few ms or tens of ms either way.

Reading (inferred, n = 1): the candidate is faster under load (load-50 +8, full run 1.52x against 1.81x, which fits rows 011-417 and 011-418) and costs more idle daemon CPU and long store writes with three worktrees. One candidate cause of the idle CPU: row 011-417 walks the daemon's process tree once per release beside another lease and per permit-returning shrink (`tasks/011-417/notes.md`). The reviewer is asked to check it; a repeat of `ref` and `wt-3` would separate it from noise.
