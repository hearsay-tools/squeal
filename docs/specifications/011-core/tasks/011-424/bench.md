# Row 011-424: benchmark, 0.1.580 against the candidate

Process step 6c. Coordinator 4abb5168, 2026-11-21. One paired run on one boat.dev sandbox (`bench/boat-run.sh --ref squeal--v0.1.580 --ref ac0faf529 --cells ref,wt-3,load-50`), cells alternated: AMD Ryzen 7 9700X, 4 vCPU, 7.8 GiB, Node 24.22.1. Results: `bench/results/2026-11-21-0.1.580-vs-0.1.583-default-AMD-Ryzen-7-9700X-8-Core-Processor/`. "0.1.583" there is the candidate as first built (`ac0faf529`, row 011-424 on 0.1.580's main); after a version swap with coordinator d36c4d53 the same row ships as 0.1.584 on top of 0.1.582, whose changes (spec 018, `ci record`) the benchmark does not touch.

**Correctness: PASS** in every cell and version.

| Cell | 0.1.580 | Candidate | Δ | Where the Δ is |
|---|---:|---:|---:|---|
| ref (1 worktree) | 61 | 66 | +5 | Store: 3 writes over 250 ms against 6 |
| wt-3 (3 worktrees) | 67 | 67 | 0 | none |
| load-50 (1 worktree, half the CPUs busy) | 64 | 59 | −5 | Store: 4 writes over 250 ms against 1 |

- **Verdicts unchanged.** Edits with a verdict within 60 s: 50%, 69%, 50% in both versions. The edit-to-told median moved −1%, +1%, −2%.
- **The score deltas are store lock holds**, which moved in both directions (ref and wt-3 down 48% in the longest hold, load-50 up 26%), n = 1 per cell. Row 011-424 changes no store write; read them as run-to-run noise.
- **What this benchmark cannot show.** No cell edits two worktrees at the same moment, and on 4 vCPUs the background ceiling is 3, so the case row 011-424 changes (`research/simultaneous-demand-2.md`: the second worktree's 178 s wait to run wide) does not occur here. The benchmark is a regression check: one worktree and three worktrees edited in turn behave as before.
