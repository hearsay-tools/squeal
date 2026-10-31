# Probes for topic remote-store (018-03): throwaway

These scripts are throwaway evidence for `../../remote-store.md`. No product code imports them. Delete them when spec 018 closes.

Each script reads a **copy** of a store, never the live one. The copy was made with `cp store.sqlite store.sqlite-wal $TMPDIR/store-copy/` (2026-10-31, from this repository's `<git-common-dir>/squeal/`).

| Script | What it shows |
|---|---|
| `table-sizes.mjs <copy>` | Rows and bytes per table and index (`dbstat`), the largest `meta` values, distinct keys. |
| `lookup-time.mjs <copy> [repeats]` | One worktree's 1,358 keys looked up with `ResultRepo.byKey`'s query: per key read-only, per key with the `last_used_at` update, and in one batched query. Also the JSON bytes of the rows. |
| `http-loopback.mjs <copy>` | The floor cost of a remote lookup over HTTP on loopback: per key (1 and 8 in flight) and one batched POST; gzip size of the reply and of a verdict-only reply. |
| `closure-size.mjs <copy>` | Size of the closure lists (`test_files`) and the shared observed-input maps (`meta` `observed*`) that a fresh clone would need to compute keys. |
| `export-sets.mjs <copy> <out>` | One results document per worktree row with 1,000 keys or more, as a stand-in for "the results of one main commit". |
| `git-ref.sh <work-dir> <sets-dir>` | Carries those documents on `refs/notes/squeal` between two fresh clones of a fixture repository through a local bare origin: default clone versus explicit refspec, fetch time, pack size. |

Run with Node 24 (`node:sqlite`) and git 2.43 or later. `git-ref.sh` makes its own fixture under the work dir; nothing touches GitHub.
