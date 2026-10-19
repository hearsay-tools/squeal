# Probe: catch-up (THROWAWAY)

Throwaway probe for `011-core/research/catch-up.md` (rows 011-22 and 011-23). Not product code; nothing imports it. No daemon, no Squeal build and no live session ran: the host's one-minute load stayed between 15 and 91 on 24 CPUs, above the brief's hold at 8. Every number is a replay of cezar's recorded store or a read of a copy of it.

- `snapshot.mjs`: copies cezar's store (`/home/agent/projects/cezar/.git/squeal/store.sqlite`, 390 MB) to `/tmp/r3/cezar-store.sqlite` through one `readOnly` connection (`VACUUM INTO`), at 2026-10-19T22:21Z. Every other script reads the copy.
- `revisions.mjs`: every retained revision (436, 24 worktrees): trigger, HEAD move, changed paths, and the fast test files the current closures say it re-keyed (`results/revisions.json`). Slow files (`packages/web/e2e/*.e2e.ts`) are counted apart.
- `explained.mjs`: which changed paths a HEAD move explains (new blob is the blob at the new HEAD and differs from the old HEAD's), and which are keyed (a test file or a closure path). Runs `git ls-tree` read-only in cezar's repository (`results/explained.json`).
- `threshold.mjs`: keyed sources changed and files re-keyed per revision, with and without a HEAD move, and what each threshold would route (`results/threshold.{txt,json}`).
- `extract-733.mjs`: the main worktree's runs after the 2026-10-19 pull: edit route (21:14:52Z to the restart at 21:41:35Z) and the restart's `run --all` c9183f; per run its files, lane, wall and per-file sums of check durations (`results/cezar-733.json`).
- `calibrate.mjs`: the tier model (makespan over W workers, longest first, plus 0.5 s per run) against those recorded runs.
- `replay-733.mjs`: the catch-up replayed under the edit route (tierSize 4 and 12), the first group at backlog width, and a third group on the backlog route, in recorded order and shortest-first (`results/replay-733.{txt,json}`).
- `second-worktree.mjs`: worktree 2d626467 (ba5234dc) on 7fe10d99: its lookup-only baselines at revision 48 and when the results its second baseline adopted were stored (`results/second-worktree.json`).
- `adoptable.mjs`: per worktree, files with no current state whose key has results stored now (`results/adoptable.json`).
- `adoption-cost.mjs`: the reads each way of learning another worktree's results costs on the copy (`results/adoption-cost.txt`).

Run: `node snapshot.mjs <store> /tmp/r3/cezar-store.sqlite`, then each script with no arguments from this directory. `explained.mjs` needs cezar's repository at `/home/agent/projects/cezar` (read only).
