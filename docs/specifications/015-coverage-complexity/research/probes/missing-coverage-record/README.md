# Probes for 015-79 (missing coverage record): throwaway

Evidence for `../../missing-coverage-record.md`. Nothing here is product code. Delete it once the repair has landed.

- `writer-busy.ts`: the records' writer from this baseline's sources, with the code store's write lock held by a second process. Run it from the worktree root with `npx tsx docs/specifications/015-coverage-complexity/research/probes/missing-coverage-record/writer-busy.ts [holdMs]`. It uses only a fresh temp directory and deletes it afterwards.
- `prune-scan.mjs`: times, read-only, the row selection that each batch of the code store's coverage prune runs inside its write transaction. Usage: `node prune-scan.mjs <commonDir>/squeal/`.
- `store-queries/q*.mjs`: read-only `node:sqlite` queries against this host's shared stores (`/home/agent/projects/squeal/.git/squeal/{store,code}.sqlite`, path fixed in each file). Each one opens the stores with `readOnly: true`. The report names which query backs which number. Main ones:
  - `q2` and `q8`: one run's results, keys and records.
  - `q6`: one file's history.
  - `q13`: where a run's missing records fall, in completion order.
  - `q14` and `q16`: record writes by every worktree around one window.
  - `q19`: the cost per job of each missing block.
  - `q21`: missing records per file.
  - `q10` and `q11`: run shape and timing of the next run.
  - `q17` and `q18`: the pause test and its control.
