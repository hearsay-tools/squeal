# 015 coverage and complexity: status

Stage: research
Started: 2026-10-23

## Decisions so far

- 2026-10-23, the human, an idea to consider: could Squeal calculate coverage and cyclomatic complexity (CC) and share them between worktrees? It could calculate CC and the CRAP score, behind an opt-in setting, feed the agent on the fly, and be available on demand. Research first.
- 2026-10-23, the coordinator's assumptions, for the spec to confirm or change: off by default, switched on in `squeal.config.json`; coverage comes only from runs Squeal makes anyway, never from an extra run; coverage and complexity are stored by content key like test results (011 C3, C4, C7), so a worktree inherits them; a push says only what changed on code the agent changed, and the rest is pull (vision, "push transitions, pull state"); Vitest first, node:test and pytest by the same contract later.
- 2026-10-23, the human: "the code can squeal as well, not just tests". Complexity and CRAP are a check type of their own (vision, Long-term direction: "Tests are the first check type, not the last"), with states, transitions and provenance like a test's, not only a note on test results. This replaces the coordinator's first reading that they fit only as a decoration of coverage.

## Open questions

1. Is the gain worth the CPU per run? The human said on 2026-10-23 that machine load is an adoption risk; coverage instrumentation adds cost to every run it is on.
2. What does the agent get: changed code that no test runs, CRAP of the functions it changed, or both? Which of them is a transition worth a push?
3. Does per-test coverage also make test selection narrower than the file closure (011 Non-goals: "Per-test closures from runtime coverage")? That would cut CPU, but it is a different feature.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).
