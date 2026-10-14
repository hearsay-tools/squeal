# 005 Agent adoption: dogfooding lessons

Board row 005-18, 2026-10-14. Spec 005 `## Testing`, the Proof bullets, with D7 and D8. Squeal at `f8d3c10a` (plugins 0.1.156). "Since the release" runs after the release and is not here.

## Part 1: spec 006's atomic tier, with D8 on (`testCommand.denyWhenCurrent`)

### What ran

28 sessions, no retry, 2026-10-14 06:10 to 06:30 UTC, one-minute load at start 1.3 to 19.1 on 24 CPUs (each session's load is in `research/probes/dogfood/part1-cells.json`). Arms: `p0` (the plugin alone) against `d8-deny` (`evals/variants/d8-deny.json`), side by side, effort `medium`. The coordinator's cells:

| Run | Fixture | Scenario | Model | Reps per arm | Sessions | Results |
| --- | --- | --- | --- | --- | --- | --- |
| R1a | warm | a2-slow | Claude Code `claude-haiku-5-5` | 4 | 8 | `evals/results/2026-10-14-0.1.156.20261014T061010Z-9e6ed6.d8-deny.atomic-variant.json` |
| R1b | warm | a1-break | Claude Code `claude-haiku-5-5` | 2 | 4 | `…20261014T061428Z-a8e6fa.d8-deny.atomic-variant.json` |
| R1c | warm | a2-slow, a1-break | Codex `gpt-6-luna` | 1 | 4 | `…20261014T061644Z-e0169f.d8-deny.atomic-variant.json` |
| R2 | cold | a2-slow | `claude-haiku-5-5` 4, `gpt-6-luna` 2 | | 12 | `run-cell.mjs --cold`, run `r2cold-20261014T061909Z`; no results file, since `run-baseline.mjs` has no cold switch: `part1-cells.json` |

Each R1 run has its `atomic-compare.md` beside it. Cost: $0.09 for the 20 Claude Code sessions; Codex reports tokens only. The gate-squeal condition (the reworded gate) got no cells, by the coordinator's decision: 005-02 measured it (no full Vitest run in 5 of 5 sessions, against 5 of 5 under a Vitest gate) and part 3 measures it in real sessions.

Isolation: every session and the runner ran as `squeal-e2e` through `research/probes/dogfood/as-e2e.mjs`, 005-17's command line (`sudo -n [--preserve-env=<names>] -u squeal-e2e -H env [-i] …`, cwd `/`), with every scratch directory and `SQ_EVALS_ROOT` under `/home/squeal-e2e/runs/sq18-p1`. The repository went in as a `git bundle` of `f8d3c10a`, so the results files name the real commit (the coordinator's Q1). Credentials by name only (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, the Codex provider's key variable); the runner's `$HOME/.codex/config.toml` holds `codexConfig`'s allow-listed fields only. The runner's own scan: 0 files held a secret in any cell.

"Cold" is real at the start: in every cold session the first Squeal evidence was "no daemon, every result unknown"; the agent edited before Squeal had any result, then waited for it (20 waits in 12 cold sessions, no sleep). On this fixture (7 fast files, one 12 s slow file) Squeal caught up within the session; part 2 is the large repository.

### How often D8 fires

**0 denies in 16 `d8-deny` sessions (0%, 95% Wilson 0 to 19%).** The accept-or-rerun split has n = 0: nothing to split. No claim followed a deny, so none could be false.

The arms are identical on every atomic measure (Fisher p 1.0 throughout): Haiku a2-slow `no-rerun-answered` 3/4 against 3/4, every `claim-true` and `no-false-pass` 4/4, 2/2 or 1/1.

Why it never fired: in 28 sessions only 3 ran Vitest themselves (all Haiku, warm a2-slow: 2 `p0`, 1 `d8-deny`), 9 commands, and **every one carried a redirect or a chain**, which D8's step 1 lets through by design: `npx vitest run test/invoice.test.ts 2>&1 | tail -40`, `npx vitest run test/clock.test.ts 2>&1 | grep -E "Tests|Test Files|FAIL|timed out" ; git diff --stat`. In the one `d8-deny` session with own runs, that third command ran while `test/clock.test.ts` held a current result: with the bare command, it would have been denied.

The same holds outside the lab. `research/probes/dogfood/d8-reach.py`, a port of `shellWords` and `vitestCommand` (`src/harness/shared/test-command.ts`, read, not imported), over this repository's 262 sessions since `97144d9` (part 3): **0 of 1,989 test commands have a shape D8 recognizes** (95% Wilson upper bound 0.2%). 55% carry a redirect (`2>&1`, nearly always with `| tail`), 38% are chained, the rest are expansions, pipes, other runners or leading assignments. This repository's agents also prefix `timeout 600`, which falls through as another command.

So as specified, D8 is safe and inert. It made no false claim possible, and it changed nothing in any session. Its reach is not limited by how often agents rerun answered results (2 of 28 sessions here; Haiku 1 to 3 in 20 in `ATOMIC.md`). It is limited by the shape of the command. **Proposed planned row** (D8, owner 005): recognize an output-only tail, `2>&1` alone or followed by one `| tail [-n] N`, `| head [-n] N` or `| grep …` stage reading only the command's stdout, as the same command. The deny's reason then stands in for the output the agent wanted to filter. Any other chain or redirect still falls through. Evidence: the 9 lab commands and the 1,989 real ones above. No count of sessions would confirm a fire rate before that row: a fire is impossible for these commands.

### Final claims, cold and warm, and sessions that end red

Every session ended red by design (a1-break and a2-slow break a test). **28 of 28 final claims were true** (`fail`, matching ground truth and Squeal's own verdict); 0 false passes (95% Wilson upper 12%). Cold made no difference to the claims: 12 of 12 true. It did change the agents' own runs: warm Haiku a2-slow ran Vitest in 3 of 8 sessions, cold in 0 of 8. That is a large gap, unconfirmed (Fisher p 0.2); 20 sessions per arm would confirm a gap of that size with 80% power (two-sided Fisher, 5%). One reading: in a cold session Squeal's first message says it is working, and Haiku waits for it rather than racing it.


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
