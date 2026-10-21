# Probe: issue 67 (throwaway)

Throwaway fixture for `research/issue-67.md`. Not product code; no test runs it.

`probe.ts` builds a synthetic store in a fresh `os.tmpdir()` directory with the
repository's own test helpers (`test/status/helpers.ts`, `test/store/helpers.ts`),
never `.git/squeal/store.sqlite` of a real checkout. It then runs:

1. `toCheckError` on a Vitest-shaped error whose top frame is a project helper
   module and whose second frame is the check's own test file.
2. `squeal failures --all-worktrees --json` and the human form, through `main`.
3. `squeal why <check>` through `main`, for a check whose two failures are
   older than 22 newer passes.

Run from the worktree root, with a `node_modules` linked or installed (kept out of git):

    node_modules/.bin/tsx docs/specifications/011-core/research/probes/issue-67/probe.ts
