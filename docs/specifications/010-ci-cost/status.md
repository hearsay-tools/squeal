# 010 CI cost: status

Stage: draft (spec written, awaiting the human's review)
Started: 2026-10-15

## Decisions so far

- 2026-10-15, the human: CI takes too long and saturates the organisation's concurrency limit. Two Node jobs of about 20 minutes per run; every branch push runs CI with no cancellation of superseded runs; 26 of the latest 100 runs re-tested a commit SHA already tested, commonly on a task branch and on main. They asked for a short spec.
- Dispatch: two researchers in parallel on Opus (board Standing models), `ci-test-time` and `ci-run-triggers` (`research/README.md`). Read-only on GitHub, no CI experiments: those cost the concurrency this spec is about.
- Both researchers done 2026-10-15 (`research/ci-test-time.md`, `research/ci-run-triggers.md`). The coordinator checked the one claim D2 rests on: only `test/cli/codex-hash.test.ts` reads this repository's `docs/`, a probe log.
- 2026-10-15, coordinator, writing `spec.md` from both findings: shards (D5) are the coordinator's choice of wall time over peak jobs, about 25 job-minutes a run against 22 unsharded; cancellation on `cand/*` and pull requests only (D3); the landing re-test, `maxWorkers` and the real concurrency limit stay open questions. Rows 010-10, 010-11 and 010-20 on the board, planned until the human approves.
