# 005 Agent adoption: dogfooding lessons

Board row 005-18, 2026-10-14. Spec 005 `## Testing`, the Proof bullets, with D7 and D8. Squeal at `f8d3c10a` (plugins 0.1.156). "Since the release" runs after the release and is not here.

<!-- PART1 -->

<!-- PART2 -->

## Part 3: this repository's sessions since `97144d9`

`research/probes/adoption-baseline/metric.mjs` (005-01's instrument, unchanged) over every Claude Code transcript and Codex rollout of this repository's Cezar worktrees holding `SQUEAL · registered`, selected as 005-01 selected them (`research/probes/dogfood/select-sessions.mjs`), this session left out. Store: a copy of this repository's `store.sqlite` at 2026-10-14 06:05 UTC. Read-only, run as `agent`; no model.

To compare like with like, the same script and selection ran over the sessions before `97144d9` (2026-10-04 to 2026-10-09 15:32 UTC). Its numbers differ slightly from 005-01's (10.8 own runs, 9.0 outside a gate) because the records are live and a few late sessions of 2026-10-09 fall on the other side of the cut. `research/probes/dogfood/compare-metric.py` tests each per-session count two-sided (Mann-Whitney U); "P(before > after)" is the chance that a random session before had more than a random session after.

| Per editing session | Before `97144d9` (n 232) | After (n 255) | Change | P(before > after) | p |
| --- | --- | --- | --- | --- | --- |
| Own test runs | 12.1 | 6.6 | -45% | 0.61 | 1.4e-05 |
| Own runs outside a full-suite gate | 10.1 | 5.9 | -41% | 0.59 | 0.0004 |
| Own full-suite Vitest runs | 2.08 | 0.70 | -66% | 0.72 | 3.5e-19 |
| Test wall time, min (mean; median) | 7.4; 3.4 | 5.7; 3.8 | -23% mean | 0.53 | 0.31 |
| Sessions pulling Squeal | 33% | 66% | x2 | | |

Workers alone (n 148 before, 96 after): own runs 12.2 to 8.9 (p 0.002); outside a gate 10.8 to 8.5 (-21%, p 0.07, not confirmed at this n); full-suite Vitest 1.44 to 0.34 per session (-76%, P 0.84, p 9e-22); test wall time 5.9 to 3.5 min (p 2e-06). Reviewers (62, 102): own runs 7.5 to 4.2, but wall time up from 7.8 to 8.3 min mean (median 3.0 to 8.4): reviewers keep `npx vitest run` as the independent check by rule, and the suite has grown.

Against goal 6's targets (the human, 2026-10-09):

- **Agent-run Vitest outside a gate at most half of 9.0 per editing session (4.5): not met.** 5.9 overall, 8.5 for workers. The fall is real (-41%, p 0.0004) but short of the target by 1.4 runs per session overall.
- **Workers' full-suite Vitest near zero: not met, though down 76%.** 34 full runs in 96 worker sessions.
- By harness, the fall is Claude Code's: 13.5 to 8.2 own runs per session. Codex was already low (3.5 to 3.4) and still is; its runs are 30% gate runs and 93% of its test wall time.

The day-by-day rate does not trend down after the rewording (5.6 to 8.9 own runs per session per day from 2026-10-09 to 10-13), so the step happened at the rewording and the 001 and 005 releases since have not moved it further at this n.

<!-- D8REACH -->
