# 023 Results at a commit: status

Stage: research (wave 0)
Started: 2026-11-16

## Decisions so far

- 2026-11-16, the human: "if the agent wanted to compare before / after state - could they just ask squeal for results for a given commit? And potentially also name a gap of what has not been recorded under that commit ... Or could squeal offer to perform this for them as well?"
- 2026-11-16, the coordinator (d36c4d53): first finding `../018-ci-and-shared-results/research/results-at-commit.md` (lands `f17f9146b`). The stored `commit_sha` label finds 0.9% (Squeal) and 4.1% (squawk) of the test files at recent main commits; keys computed from `git ls-tree` with this worktree's closures and environment work without a checkout; reuse 1/10/50 main commits apart is 91/50/27% (Squeal) and 73/25/2% (squawk); running the missing checks needs a checkout.
- 2026-11-16, the human on the card: "Spec with auto-run" (one slice: the lookup and Squeal itself making a temporary checkout, installing and running the missing test files within a budget); retention "Keep 7 days" (the prune rule does not change; results at a commit are a recent-commits feature).
- 2026-11-16, the coordinator: a new spec, not an amendment of 018 (shared results) or 020 (the gate): the question is a commit argument, its lookup and its run. Wave 0 researches the auto-run half and the environment-differs case before the spec is written.
- 2026-11-16, the human through coordinator 5a80b2e0: add red proofs as a use case. In cezar, agents ran 39 tests by hand for red proofs (the new test against the code before the fix, required by cezar's review rules); they restored the old files in the watched worktree, and Squeal reported failures for that state (`../011-core/research/hand-runs-2026-11-16.md` item 4, main `7f78bddeb`). The coordinator's reading: this is a mixed tree, the current test files over the source at X, not X as it was; the auto-run checkout must accept "test files from HEAD" so a red proof runs outside the user's tree. The spec carries it as a goal with its own example.
