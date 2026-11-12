# Row 011-315: the code-store prune without a full key read

Worker b9f04257, wave 75 W2, 2026-11-12. Brief: `../wave-75.md` W2. Research: `../../research/daemon-idle-cpu.md` section 2.

## The change

- `pruneCodeStoreAfter` no longer calls `results.keysSince(0)`. It passes `resultKeys` as a function: the code store's prune reads the keys its coverage records hold (`SELECT DISTINCT result_key FROM coverage`, from the covering index `coverage_stored`, about 2,000 page reads) and asks the main store about those keys only.
- `ResultRepo.keysWithResults(keys)` (new): one `results_by_key` search per key, 1,000 keys a statement through `json_each`.
- The prune deletes only a record whose key it asked about and that has no result. Before, it deleted every record whose key was not in the list, so a record another daemon stored after the list was read went too. The test "asks the main store only about the keys the coverage records hold" stores such a record during the prune and expects it to stay.
- `CodePruneOptions.resultKeys` takes a list (as before, used by tests) or the function (`ResultKeysOf`). Both go through the same path.

## Measurements

Copy of cezar's stores (`/home/agent/projects/cezar/.git/squeal/{store,code}.sqlite`, 3.9 GB and 1.2 GB, no process had them open, copied with `cp` at 10:17Z) in the worker's scratch directory. The probe is `../../research/probes/daemon-idle-cpu/prune-probe.ts COPY 2` on a fresh copy of the pristine copy each time: pass 1 is the first prune after the copy (pages partly cached), pass 2 runs right after it.

Store sizes: 3,891,669 results under 255,190 keys; 102,764 coverage records, each at its own key, every one with a result.

| Code-store prune | Pass 1 | Pass 2 | Load average |
|---|---|---|---|
| Before (main at 2fbaefc4) | 34.0 s, 0.89 M reads, 3.63 GB | 6.6 s | 12.4 to 14.3 |
| Key check only | 16.7 s, 0.39 M reads, 1.58 GB | 3.1 s | 40.8 to 27.8 |

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

## What is left in pass 1

After the key check, pass 1's other code-store statements read the code store's large tables in full each hour (pass 1, load about 40):

| Statement | Wall | Reads | Why |
|---|---|---|---|
| `SELECT DISTINCT worktree_id` over files, states, views, transitions | 5.9 s | 68 k | scans the four tables; 24 ids in 2.8 M state rows |
| `DELETE FROM counts …` | 3.4 s | 108 k | reads `counted_at` past each row's functions text, and every state's blob |
| `DELETE FROM checks …` | 1.0 s | 76 k | reads every state's check id |
| `DELETE FROM states … worktree_id NOT IN (…)` | 0.4 s | 67 k | scans states |
