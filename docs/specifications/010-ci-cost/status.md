# 010 CI cost: status

Stage: draft (research)
Started: 2026-10-15

## Decisions so far

- 2026-10-15, the human: CI takes too long and saturates the organisation's concurrency limit. Two Node jobs of about 20 minutes per run; every branch push runs CI with no cancellation of superseded runs; 26 of the latest 100 runs re-tested a commit SHA already tested, commonly on a task branch and on main. They asked for a short spec.
- Dispatch: two researchers in parallel on Opus (board Standing models), `ci-test-time` and `ci-run-triggers` (`research/README.md`). Read-only on GitHub, no CI experiments: those cost the concurrency this spec is about.
