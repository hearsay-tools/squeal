# 001-409 `squeal failures`: notes

Wave 14 W3, commit 7486e392.

## Seam map

- `src/cli/failures.ts`: argument parsing (`--all-worktrees`, `--since <d>` or `--since=<d>`, `--json`) and `durationMs` (`90s`, `30m`, `2h`, `1d`; anything else is exit 2). Wired from `src/cli/main.ts` beside `why`; `StoreCommand` gained `"failures"`, so `main` returns a number synchronously for it.
- `src/core/status/failures.ts`: `readFailures` (one `withStatusStore` read transaction, the same read-only open as `status` and `why`: `create: false`, no integrity check, no daemon) and `formatFailures`.
- `src/core/store/repos/results.ts`: `listFailures(filter, limit)` and `countFailures(filter)`, one SQL predicate (`FAILURE_WHERE`) where a `null` filter field matches every row. No index added: the count scans `results`; at D8's 5,000-test steady state that is milliseconds.
- `src/core/types/store.ts`: `FailureFilter`, the two `ResultRepo` methods (additive). `src/core/types/status.ts`: `FailureEntry`, `FailuresReport`, `FailuresResult` (additive).
- `src/core/status/open.ts` needed no change: `withStatusStore` already opens read-only.

## Decisions the spec did not settle

- Cap: `FAILURES_LIMIT = WHY_RESULT_LIMIT` (20), with `total` so the header says `newest 20 of 57`.
- Without `--all-worktrees` the list is the failures this worktree produced (`provenance.worktreeId`), not failures it inherited or holds; `--all-worktrees` lists every producer, removed worktrees named by id.
- "Fingerprint summary" prints the fingerprint's first line capped at 160 characters, the summary when there is no fingerprint; `--json` carries both whole and no stacks (`why` prints those).
- A stored `fail` replaced by a later outcome under the same key (`INSERT OR REPLACE` on check and key) is gone, so the list is the failures still stored, not every failure ever seen.
- Exit codes as `status`: 0 with an answer, failures or not; 1 unavailable; 2 usage.

## For the coordinator

- The skill references (`plugins/*/skills/squeal/references/commands.md`) do not list `squeal failures` yet; they are outside this row's ownership.
