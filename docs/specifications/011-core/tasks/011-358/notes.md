# Rows 011-358 and 011-359: two CI timing failures outside the scheduler

Worker c7bf1fcf, wave 107 W2, 2026-11-16. Both causes are in the tests. Neither is a product slowdown. Timings are from this host (24 vCPUs, shared with the project's other workers); each names its one-minute load.

## 011-358: `why-unknown-standing.test.ts`, "keeps every standing record of more than 1,024 across worktrees through a prune"

**Cause: the case's own check loop costs the square of its records.** It checks all 1,200 checks (600 in each of 2 worktrees) through `unknownRunOf`. Each call reads `store.failures.unknownRuns(worktreeId)`. That call reads and parses the whole `unknown-runs` meta list (1,200 records), then filters it. So the loop reads and parses 1,200 records 1,200 times.

Evidence, from a temporary probe of the same steps (3 runs, load 28):

| Phase | ms |
|---|---|
| fixture repo and store | 13–25 |
| 12 runs and 12 ledger commits | 141–188 |
| prune | 18–36 |
| 1,200 `unknownRunOf` calls | 1,231–1,598 |
| one `unknownRuns` read | 0.7–1.3 |

The check loop is 85% of the case. The seed and the prune it exists to test take about 200 ms. A CI runner at load that is 3 to 4 times slower than this host reaches the 5 s Vitest timeout.

**Not a product slowdown.** `why` calls `unknownRunOf` once per call (`src/core/status/why.ts:214`), so it reads the list once. Nothing else in `src/` calls it in a loop.

**Change** (`d1d721575`): `recordsReadOnce(store, worktreeId)` reads a worktree's records once and returns the store with `failures.unknownRuns` answering from that read. The loop still checks every check through the real `unknownRunOf`, and still checks the count of 600 and every run that prune kept. Case time: 1,679 ms before (load 18.5), and 455, 561 and 461 ms after (load 29–33). No bound changed.

## 011-359: `lifecycle.test.ts`, "after SIGKILL a replacement serves soon after its spawn"

**Cause: the bound compares two single samples taken at different moments.** The reference cold start was measured once, before the kill. The replacement was measured once, seconds later. Each under whatever load the shared runner had at that moment. A load burst during the replacement alone fails the case.

Evidence:

- The failing job (CI 43748848817, job 132918080540, Node 22 2/3): cold start 306 ms, replacement 2,365 ms (7.7 times). Other test files ran beside it in that shard.
- 66 earlier CI pairs from the 33 runs before it (main and candidate, Node 22 and 26), from the case's own log line: replacement over cold start was 0.72 to 1.49 (median 0.96, 90th percentile 1.25). The replacement took 258–910 ms (median 462); the cold start 258–893 ms (median 516). None came near 3 times. The 2,365 ms is 2.6 times the slowest replacement in the other 66 samples, and the cold start of 306 ms was near the fastest. One stall, not a restart delay.
- Locally (load 28–32): replacement against cold start 613/618, 671/991 and 785/790 ms.
- The lock is an SQLite exclusive lock that the OS frees at the kill (`src/core/daemon/lock.ts`). The replacement takes it at once, with no wait.

A second unlike thing: two processes of the killed daemon outlive the SIGKILL and run beside the replacement. They are its runner host (`cli runner-host <root> --runner vitest`) and its full integrity check (`squeal main check`, `PRAGMA integrity_check` on a read-only connection). Both were reparented and in state R right after the kill. On the fixture both ended within about 120 ms. The cold start before the kill had neither beside it.

**Change** (`3015345d6`): the reference is now a cold start in a fresh fixture, spawned at the same moment as the replacement (`servesAfter`, both awaited together). A load burst, and the dead daemon's leftover processes, slow both. The cold start still does more work, because it creates its store. The factor 3 stays, against a like measurement. The log line now names the replacement, the cold start beside it and the first cold start. Local runs (load 23–26): 615/558, 500/605 and 687/660 ms (replacement / cold start beside it).

The case still catches a real restart delay: anything the dead daemon left that holds the replacement up (its socket file, its lock, its store) slows only the replacement, not the fresh fixture's cold start.

## For the coordinator

- The 20-rerun part of each done-when needs CI; it was not run here.
- Not in scope, an observation: the killed daemon's integrity check runs on after its parent died. On the fixture it ends in about 120 ms. On a large store (`integrity_check` reads every page) it would run beside the replacement's own check until it ends. Measured nowhere; a candidate for a proposed row if it matters.
