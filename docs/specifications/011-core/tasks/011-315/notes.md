# Row 011-315: the code-store prune without a full key read

Worker b9f04257, wave 75 W2, 2026-11-12. Brief: `../wave-75.md` W2. Research: `../../research/daemon-idle-cpu.md` section 2.

## The change

- `pruneCodeStoreAfter` no longer calls `results.keysSince(0)`. It passes `resultKeys` as a function: the code store's prune reads the keys its coverage records hold (`SELECT DISTINCT result_key FROM coverage`, from the covering index `coverage_stored`, about 2,000 page reads) and asks the main store about those keys only.
- `ResultRepo.keysWithResults(keys)` (new): one `results_by_key` search per key, 1,000 keys a statement through `json_each`.
- The prune deletes only a record whose key it asked about and that has no result. Before, it deleted every record whose key was not in the list, so a record another daemon stored after the list was read went too. The test "asks the main store only about the keys the coverage records hold" stores such a record during the prune and expects it to stay.
- `CodePruneOptions.resultKeys` takes a list (as before, used by tests) or the function (`ResultKeysOf`). Both go through the same path.
- Second commit, on the coordinator's decision A (request b03837f9): the prune finds the worktree ids of `files`, `states`, `views` and `transitions` by an index walk (`worktreeIdsOf`: `min(worktree_id)`, then the next id above it, one search per id) and deletes only the rows of the dead ids it found, nothing when there are none. Before, one `SELECT DISTINCT` read all four tables, and each per-worktree delete scanned its table with `worktree_id NOT IN (live)`. Rows a worktree stores after the walk stay until the next prune.

## Measurements

Copy of cezar's stores (`/home/agent/projects/cezar/.git/squeal/{store,code}.sqlite`, 3.9 GB and 1.2 GB, no process had them open, copied with `cp` at 10:17Z) in the worker's scratch directory. The probe is `../../research/probes/daemon-idle-cpu/prune-probe.ts COPY 2` on a fresh copy of the pristine copy each time: pass 1 is the first prune after the copy (pages partly cached), pass 2 runs right after it.

Store sizes: 3,891,669 results under 255,190 keys; 102,764 coverage records, each at its own key, every one with a result.

| Code-store prune | Pass 1 | Pass 2 | Load average |
|---|---|---|---|
| Before (main at 2fbaefc4) | 34.0 s, 0.89 M reads, 3.63 GB | 6.6 s | 12.4 to 14.3 |
| Key check only (2d5667c9a) | 16.7 s, 0.39 M reads, 1.58 GB | 3.1 s | 40.8 to 27.8 |
| Key check and worktree walk | 20.9 s, 0.25 M reads, 1.01 GB | 2.2 s, 0.25 M reads | 17.4 to 23.0 |

Pass 1 depends on which pages the copy left in the page cache and on the host's load; its read count does not. The coordinator amended the done-when (reply to request b03837f9): pass 2 under 5 s, pass 1 reported with the load and not bounded. In the last pass 1 the counts sweep took 11.6 s: it was now the first statement to read the `states` table, which the dead-worktree scan had read before it.

The key read alone: `keysSince(0)` 23.2 s in pass 1 and 3.6 s in pass 2 (403 k reads); `keysWithResults` 5.1 s and 0.3 s (57 k reads, 103 statements).

Ways to ask about the 102,764 keys, measured on the pristine copy (`bench2.mjs`, not kept), second round, pages cached:

| Query | Wall | Reads |
|---|---|---|
| `json_each`, all keys in one statement | 0.73 s | 57 k |
| `json_each`, 1,000 keys a statement | 0.44 s | 57 k |
| `json_each`, 10,000 keys a statement | 0.51 s | 57 k |
| `IN (?, …)`, 500 keys a statement | 0.70 s | 68 k |
| `SELECT DISTINCT key FROM results` (all 255,190) | 3.5 s (first touch) | 89 k |

With the pages evicted first (`posix_fadvise(DONTNEED)` on both files), each way took about 7 s: 57 k to 89 k random 4 KB reads. In a live daemon `results_by_key` is the index every lookup uses, so its pages are more likely cached than `results_by_time` and the result rows `keysSince(0)` read.

The worktree walk on the pristine copy (`bench3.mjs`, not kept): 24 ids from `files`, 24 from `states`, none from `views`, 8 from `transitions`, each in 0.1 k reads or fewer and under 10 ms; the old `SELECT DISTINCT` over the four tables read 68.4 k pages in 5.6 s.

## What is left: a possible later row

After both commits, two code-store statements still read whole tables each hour. Both stay as they are (the coordinator's decision; a cheap fix needs an index, which is a store format change).

| Statement | Pass 1 | Pass 2 | Reads | Why |
|---|---|---|---|---|
| `DELETE FROM counts …` | 3.4 s (load 40), 11.6 s (load 20, first to read `states`) | 0.9 s | 108 k | reads `counted_at` past each row's `functions` and `errors` text (overflow pages), and every state's blob for `blob NOT IN (SELECT blob FROM states)` |
| `DELETE FROM checks …` | 1.0 s | 0.9 s | 76 k | reads every state's check id for `id NOT IN (SELECT check_id FROM states UNION …)` |

The code store at the copy: `counts` 18,915 rows in 41,215 pages, `states` 2,799,037 rows of 24 worktree ids in 66,776 pages, `checks` 93,037 rows.

Indexes they would need, none measured:

- counts: `counts (counted_at)`, so the old counts are found without reading their text; and `states (blob)`, so each candidate is one search instead of the list of every state's blob.
- checks: `states (check_id)`, so a check is one search, or the list of check ids comes from the smaller index instead of the table.
- Cost: every state write (2.8 M rows on cezar) also writes the new `states` indexes. Weigh that against about 184 k page reads an hour before proposing it.

Before the change, without an index, a cheaper order may help the counts sweep: test `NOT EXISTS` on `files` before `counted_at`, and build the states blob list only when a candidate is left. Not tried.

## Scratch scripts

Not kept: `bench.mjs`, `bench2.mjs`, `bench3.mjs` and `stats.mjs` read the copies with `node:sqlite` read-only and printed wall, CPU and `/proc/self/io` reads per query; `evict.py` called `posix_fadvise(DONTNEED)` on the copies. The copies were deleted after the measurements.
