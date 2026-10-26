# Throwaway probes for `research/main-pull-reuse.md`

Throwaway. Read-only queries against the Cezar store (`node:sqlite`, `readOnly: true`) and
tree-to-tree `git diff`. They start no daemon, write no store and change no checkout.

- `q.mjs <store> "<sql>"`: one query, one JSON line per row.
- `classify.mjs <repo> <main id> <pull time> <final commit>`: each main test file at the pull,
  inherited or not; for a miss, the recorded commit whose closure and environment files differ
  least from the final commit.
- `peers.mjs <store> <main id>`: per other worktree, test files whose closure hashes (every path hashed in both; drop the `!== undefined` test for the looser count) equal
  main's, and whether the stored keys are equal too.
- `case.mjs <store> <main id> <other id> <project>`: examples of equal closure hashes with
  different keys.
