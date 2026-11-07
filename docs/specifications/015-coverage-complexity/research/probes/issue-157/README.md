# Throwaway probe for issue 157

This is research evidence, not a product test. Run from the repository root with
its installed dependencies. It uses the real code pass, SQLite stores and
tree-sitter counter from this checkout, and calls the packaged CLI supplied as
its argument. The revision source and test-listing revision are controlled.
No daemon or test runner starts. Coverage is off to isolate function inventory.

```sh
pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-157/reproduce.ts /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs
```

The script checks one-minute load against available CPUs before making a fixture.
It creates a fresh Git repository under `run-*` in this directory and deletes it
in `finally`. It neither commits the fixture nor changes an existing store.
Do not commit `run-*` or `node_modules`.

`result.jsonl` is the captured successful run on 2026-11-07. Every CLI invocation
exited 0. Assertions compare the uncounted file with a counted empty control,
prove that the listing gate can keep the file out of the index, and prove that
counting later succeeds with identical, still-untracked bytes. Additional
controls cover an edited counted file and an index row without a count.

The probe does not reproduce the original project's 25-minute delay, watcher,
runner listing failure, daemon restart, coverage state or scheduling load.
