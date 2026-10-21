# 011-82 probes

Read-only. Every probe opens a store with `node:sqlite` `readOnly: true` and reads run logs (`<store>/runs/<run-id>/report.json`, `vitest.log`). None connects to a daemon, writes a store or signals a process. No clone, no daemon and no test ran for this row.

`sh run.sh` runs them all over both live stores (`/home/agent/projects/{squeal,cezar}/.git/squeal/`) for the last 24 hours and writes `results/squeal.txt` and `results/cezar.txt`, each step headed by its UTC time and the one-minute load. Per-run rows go to `$OUT` (default `/tmp/p82`), outside the repository. The design's numbers are the run of 2026-10-21T20:46Z, load 49 to 52 on 24 CPUs.

| Probe | What it measures |
| --- | --- |
| `tiers.mjs` | Per run: files picked, stored (a result row still names the run), withheld by the adapter, ended without a row, never ended; for each file not stored, whether a revision during the run changed a path of its closure or observed set (today's closures, so approximate). Sums by size and by cancel. |
| `order.mjs` | A list-scheduling model of each large tier in Vitest's order (longest first) and in Squeal's (the pick order), at a width fitted to the worktree's finished tiers. Its fit is poor (it ends 568 files where 1,531 ended on squeal), so the design uses it only for the remainder and the makespan comparison, as bounds. |
| `gaps.mjs` | Per large tier: seconds from the worktree's last revision to its start, and to the next revision. Which tiers a quiet wait of Q s would have kept from starting, always or only after a cancel, and the delay it adds to tiers that finished. A held tier counts as never started in its gap. |
| `reversed.mjs` | Whether a cancelled tier's modules ended in pick order, in reverse, or mixed (Spearman rho over the `MODULE` lines). Its `shortestFirstFloor` is not used: it mixes my duration estimates with Squeal's. |
| `withheld.mjs` | Runs whose adapter failure withheld files (tasks 001-146, 001-159), and the path each named. |
| `endorder.mjs` | The pick positions of a large tier's modules in the order they ended. |
| `burst.mjs` | 716a6766's 23 batches against its revisions, from `results/716a6766.txt`. |

`results/716a6766.txt` is the only record left of worktree `716a6766` (Squeal 0.1.240): the host-load coordinator's `wt.mjs` output of about 18:10Z on 2026-10-21, copied from task 3800fd79's transcript. Prune removed the worktree's rows and run logs once the worktree was deleted.
