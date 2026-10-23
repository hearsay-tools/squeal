# 015 coverage and complexity: status

Stage: research done; spec being written
Started: 2026-10-23

## Decisions so far

- 2026-10-23, the human, an idea to consider: could Squeal calculate coverage and cyclomatic complexity (CC) and share them between worktrees? It could calculate CC and the CRAP score, behind an opt-in setting, feed the agent on the fly, and be available on demand. Research first.
- 2026-10-23, the coordinator's assumptions, for the spec to confirm or change: off by default, switched on in `squeal.config.json`; coverage comes only from runs Squeal makes anyway, never from an extra run; coverage and complexity are stored by content key like test results (011 C3, C4, C7), so a worktree inherits them; a push says only what changed on code the agent changed, and the rest is pull (vision, "push transitions, pull state"); Vitest first, node:test and pytest by the same contract later.
- 2026-10-23, research 015-01 to 015-03 done (`research/coverage-collection.md`, `complexity-and-crap.md`, `agent-feedback.md`). What they settle, as inputs, not decisions:
  - Coverage: Vitest gives one coverage payload per test file in the warm instance. A v8 provider of Squeal's own (`provider: "custom"`) needs no project package and writes no report. Cost: +8% CPU per run, wall time within noise at load 28 to 62. istanbul is ruled out (+28% wall, visible to tests). A mapped, path-relative record is 9 KiB per test file, keyed like the result, adopted and pruned with it; 0 differences over two runs.
  - Fidelity: one test that reads its own V8 coverage through `node:inspector` passed with coverage off and failed under v8. 011 C10 makes that a defect, so the spec needs a rule for such test files.
  - Complexity: web-tree-sitter, already shipped, plus the TSX grammar (+1.45 MB per plugin) equals ESLint's `complexity` on 481 of 481 `src/` files and radon on 2,064 of 2,064 Python functions, at 2 to 4 ms per file. Keyed by blob id and counter version; no test run.
  - CRAP: Savoia's `CC² × (1 − cov)³ + CC`, threshold 30, on the function's own statement coverage, since basis-path coverage is unavailable; join to coverage by position, never by name.
  - The code as a check type (open question 1): feasible for CC with conditions (functions already above the threshold never join Known failures, only a new or touched function can fail, identity survives moves, the number stays out of the fingerprint); for CRAP only if its state is pending until every test file that loads the function's source is current. Identity is weak for anonymous functions (38%) and shared names (1.1%). Code reached only through child processes reads uncovered.
  - Push or pull: no source measures coverage or complexity feedback pushed to an agent mid-task; the strong evidence is for writing tests, where coverage saves work more than it adds result. Peers that notify scope to changed code. Proxy over the last 100 commits: a touched function crossing CRAP 30 fires in 0 to 8 commits, by coverage.
  - Selection, a separate gain: on a 30-file sample over 76 edits, line-level selection needed 259 runs against 899 at file level (71% fewer); not sound for every program; against 011's non-goal.
  - A defect present today, independent of 015: a project whose own config enables coverage gets its `coverage/` deleted and rewritten by Squeal's warm instance, and a failed threshold sets the daemon's exit code. Row 013-07.
- 2026-10-23, the human, on the research: write spec 015, complexity first. Wave 1 makes complexity a check type of its own, with no coverage; wave 2 adds Squeal's own v8 coverage, CRAP and "no test runs this function". Both opt-in.
- 2026-10-23, the human: a test file whose closure loads `node:inspector` gets no coverage (it can read its own V8 coverage, and one such test failed under v8, 015-01 Q5); status names those files, and a source only they cover reads "coverage unknown".
- 2026-10-23, the human: line-level selection (015-01 Q7) is measured on the full suite after 015's coverage records are in the store, not now; 011's non-goal stands until then.

## Open questions

1. Can the code squeal as well, not just tests? The human, 2026-10-23: "the code can squeal as well, not just tests"; seriously considered, and it "would help me a ton if it was feasible", but not a decision until the research comes back. The reading to test: complexity and CRAP as a check type of their own (vision, Long-term direction: "Tests are the first check type, not the last"), with a state per function, transitions and revision provenance like a test result, not only a note on test results.
2. Is the gain worth the CPU per run? The human said on 2026-10-23 that machine load is an adoption risk; coverage instrumentation adds cost to every run it is on.
3. What does the agent get: changed code that no test runs, CRAP of the functions it changed, or both? Which of them is a transition worth a push?
4. Does per-test coverage also make test selection narrower than the file closure (011 Non-goals: "Per-test closures from runtime coverage")? That would cut CPU, but it is a different feature.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).
