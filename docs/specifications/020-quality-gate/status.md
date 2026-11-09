# 020 One quality gate: status

Stage: approved (2026-11-09); wave 1 building.
Started: 2026-11-09
Issue: [#167](https://github.com/hearsay-tools/squeal/issues/167)

## Decisions so far

- 2026-11-09, the human (in a cezar session, recorded in #167): product rules accepted. Changed JS/TS functions against the PR target, test callbacks included; CC ≤ 20, CRAP ≤ 30, equality passes; unknown, stale, missing or partial evidence never passes; failed tests block; 600 s default budget; verified exceptions keep the scores; one engine and one evaluator for the daemon, a local command and CI. The architecture was left to this repository.
- 2026-11-09, the human, decision card "#167 path: A: Research, then spec". Row 015-126 (researcher e3483a97, `../015-coverage-complexity/research/quality-gate.md`) found that the parts compose with no daemon, at most +32% CPU over plain `vitest run` on 30 files. 6 of the issue's 10 collection cases work, 3 are gaps and 1 does not apply. The research recommends a 5-row first slice.
- 2026-11-09, the coordinator (31e1d860): a new spec, not a 015 amendment. The gate is a new command with its own evaluator and report, and its later slices touch 018 (CI) and 015 (daemon). Spec 015 D1 and D9 stay unchanged outside `squeal quality` until slice 2. D4 (the join repair) is the one daemon-visible change of slice 1.
- 2026-11-09, the human: the command is `squeal code --base <ref>`, not `squeal quality` ("squeal code is kind of already doing a report on quality"). Then "Spec 020: Approve, build it" and "Unmeasured: Project skip list". The coordinator mapped the skip list to 015's existing `coverage.exclude`, whose meaning is the same: a matched file keeps its complexity and gets no CRAP. Its functions read `skipped`, are named, never count as pass and do not block. The limits are 015's `complexity.threshold` and `crap.threshold`, read at the base, not new keys. D1, D5, D6 and D7 were edited to match. The format is `squeal-code-gate/1`. The module is `src/core/code/gate/`.
- 2026-11-09, the coordinator: wave 1 brief `tasks/wave-1.md`. The contract `src/core/code/gate/types.ts` was written by the coordinator, on the candidate branch only, so that 020-01 to 020-03 run in parallel.
