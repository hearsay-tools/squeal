# Probes for row 018-72 (gh-261, `server` keys): throwaway

These scripts are throwaway. They back `../../issue-261-server-keys.md` and are not product code or tests. All ran on this host, read only: squawk's store opened with node:sqlite `readOnly` and `PRAGMA query_only` (never copied, no daemon touched), `git ls-tree` / `merge-base` in squawk's clone, and two exports fetched into a scratch repository outside this tree (`git fetch` of `refs/squeal/444e9ae4…` and `refs/squeal/9682a717…`, unpacked to JSON, removed at the end). The `.ts` scripts import Squeal's own source from this worktree and run with `node_modules/.bin/tsx`.

| Script | Question | Output |
|---|---|---|
| `q.mjs` | any one SQL statement | stdout |
| `week.cjs` | Q1: the parent's pull-rerun rule (copied from `ffload-commits.cjs`, rule A), each unmatched file-run classed by cause and CI Squeal version | `out-week.json` (`SAMPLE=1` adds per-event samples, kept in scratch only) |
| `d5.ts` | Q2: Squeal's D5 counts (`readImports`) and the per-file reason, per worktree, for one import (`IMPORT=`) | `out-d5-9682.jsonl` (counts and every file that is not "same key") |
| `rekey-check.ts` | Q2: export key proven, closure sizes, and which list reproduces the worktree's own key | `out-rekey-check-9682.jsonl` |
| `closure-diff.mjs`, `one-file.mjs`, `local-observed.mjs` | Q2: exported against stored closure lists and observed maps | stdout |
| `modules-equal.mjs` | Q2 (a): stored list + observed + observedModules against CI's list | `out-modules-equal-9682.jsonl` |
| `git-entry.ts`, `content-paths.mjs` | Q2 (b): `.git` keyed as a file against the commit tree | `out-git-entry-9682.jsonl` |
| `proven.ts` | Q2, Q3: how many exported keys reproduce at their commit | stdout |
| `env-pair.mjs`, `env-diff.mjs` | Q2, Q4: environment descriptor differences | `out-env-ci-vs-local.txt`, `out-env-server-week.txt` |
| `same-commit.mjs`, `key-times.mjs` | Q3: local keys per file and when, at one clean commit | `out-same-commit-444e.json`, `out-key-times-444e.txt` |
| `decompose.ts` | Q3: does any recorded environment with any of three lists reproduce a stranded run key | `out-decompose-444e.json` |
| `cost.mjs` | Q2: local runs and check time of named files | stdout |

Run from this directory, for example `node week.cjs ~/projects/cezar/.git/squeal/store.sqlite ~/projects/cezar 7` with `NOW=<epoch ms of 2026-11-21T11:27:21.348Z>` for the same window, or `../../../../../../node_modules/.bin/tsx rekey-check.ts <export.json> <worktreeId> <path-regex>`.
