# 020 One quality gate: status

Stage: draft (spec written 2026-11-09; waiting for the human's design review). No implementation is authorized.
Started: 2026-11-09
Issue: [#167](https://github.com/hearsay-tools/squeal/issues/167)

## Decisions so far

- 2026-11-09, the human (in a cezar session, recorded in #167): product rules accepted. Changed JS/TS functions against the PR target, test callbacks included; CC ≤ 20, CRAP ≤ 30, equality passes; unknown, stale, missing or partial evidence never passes; failed tests block; 600 s default budget; verified exceptions keep the scores; one engine and one evaluator for the daemon, a local command and CI. The architecture was left to this repository.
- 2026-11-09, the human, decision card "#167 path: A: Research, then spec". Row 015-126 (researcher e3483a97, `../015-coverage-complexity/research/quality-gate.md`) found that the parts compose with no daemon, at most +32% CPU over plain `vitest run` on 30 files. 6 of the issue's 10 collection cases work, 3 are gaps and 1 does not apply. The research recommends a 5-row first slice.
- 2026-11-09, the coordinator (31e1d860): a new spec, not a 015 amendment. The gate is a new command with its own evaluator and report, and its later slices touch 018 (CI) and 015 (daemon). Spec 015 D1 and D9 stay unchanged outside `squeal quality` until slice 2. D4 (the join repair) is the one daemon-visible change of slice 1.
