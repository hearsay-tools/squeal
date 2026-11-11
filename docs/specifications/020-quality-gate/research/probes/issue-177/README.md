# issue-177 probe (throwaway)

Research evidence for `../../issue-177.md`, not a product test. Nothing here is
imported by Squeal or run by its suites. `.scratch/` is ignored and never
committed; `node_modules` there is a symlink to this worktree's.

- `fixture.sh [<squeal.mjs>]`: builds a synthetic Git repository under
  `.scratch/`, commits a base, makes a behaviour-neutral refactor in the
  working tree (helpers moved verbatim to a new module, one helper renamed,
  test callbacks retitled, reindented, edited into a sibling's body, a new
  empty callback, a new real callback), then runs `squeal code --base HEAD`
  as text and as `--json`. Skips while the one-minute load is above the CPU
  count. Default CLI: this worktree's `plugins/claude-code/dist/cli/squeal.mjs`
  (0.1.430). Output of the run on 2026-11-11: `run.txt`.
