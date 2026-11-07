Suite: 1504 automatic test files, 6696 recorded s.

By reach:
| # | File | Test files | Recorded s | Share | Path kinds (% of its seconds) | Edits | Called / loaded only / not loaded % |
|---|---|---|---|---|---|---|---|
| 1 | `src/core/daemon/paths.ts` | 1504 | 6696 | 100% | barrel 41, helper 25, setup 17, transitive 15 | 0 | 57 / 19 / 17 |
| 2 | `src/core/delivery/harness-process.ts` | 1504 | 6696 | 100% | helper 34, setup 26, transitive 21, barrel 19 | 0 | 56 / 12 / 25 |
| 3 | `src/core/delivery/slots.ts` | 1504 | 6696 | 100% | helper 36, transitive 23, barrel 22, setup 20 | 0 | 17 / 56 / 20 |
| 4 | `src/core/fs/compare.ts` | 1504 | 6696 | 100% | barrel 90, transitive 5 | 0 | 46 / 43 / 4 |
| 5 | `src/core/fs/concurrency.ts` | 1504 | 6696 | 100% | barrel 96 | 0 | 40 / 49 / 4 |
| 6 | `src/core/fs/errors.ts` | 1504 | 6696 | 100% | barrel 54, helper 28, transitive 14 | 0 | 51 / 38 / 4 |
| 7 | `src/core/fs/git-layout.ts` | 1504 | 6696 | 100% | barrel 54, helper 28, transitive 14 | 0 | 69 / 20 / 4 |
| 8 | `src/core/fs/git.ts` | 1504 | 6696 | 100% | barrel 84, transitive 8, helper 5 | 0 | 41 / 48 / 4 |
| 9 | `src/core/fs/index.ts` | 1504 | 6696 | 100% | helper 47, transitive 36, direct 10 | 0 | 0 / 89 / 4 |
| 10 | `src/core/fs/json.ts` | 1504 | 6696 | 100% | barrel 96 | 0 | 68 / 21 / 4 |
| 11 | `src/core/fs/paths.ts` | 1504 | 6696 | 100% | barrel 58, helper 27, transitive 11 | 0 | 44 / 45 / 4 |
| 12 | `src/core/types/common.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 0 | 0 / 86 / 6 |
| 13 | `src/core/types/daemon.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 0 | 48 / 39 / 6 |
| 14 | `src/core/types/delivery.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 0 | 0 / 86 / 6 |
| 15 | `src/core/types/index.ts` | 1504 | 6696 | 100% | helper 44, transitive 33, direct 14, setup 6 | 0 | 0 / 86 / 6 |
| 16 | `src/core/types/policy.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 0 | 0 / 86 / 6 |
| 17 | `src/core/types/runner.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 2 | 9 / 77 / 6 |
| 18 | `src/core/types/scheduler.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 1 | 62 / 24 / 6 |
| 19 | `src/core/types/state.ts` | 1504 | 6696 | 100% | typesModule 94, setup 6 | 0 | 0 / 86 / 6 |
| 20 | `src/core/types/store-records.ts` | 1504 | 6696 | 100% | barrel 93, setup 6 | 0 | 0 / 86 / 6 |
| 21 | `src/core/types/store.ts` | 1504 | 6696 | 100% | barrel 79, transitive 9, setup 6, helper 6 | 1 | 66 / 21 / 6 |
| 22 | `src/core/types/watcher.ts` | 1504 | 6696 | 100% | barrel 94, setup 6 | 0 | 0 / 86 / 6 |
| 23 | `test/daemon/strays.ts` | 1504 | 6696 | 100% | setup 80, helper 19 | 0 | 14 / 6 / 73 |
| 24 | `test/global-teardown.ts` | 1504 | 6696 | 100% | setup 100 | 0 | 0 / 0 / 93 |
| 25 | `vitest.config.ts` | 1504 | 6696 | 100% | setup 100 | 0 | 0 / 0 / 93 |

By real edits x reach:
| # | File | Test files | Recorded s | Share | Path kinds (% of its seconds) | Edits | Called / loaded only / not loaded % |
|---|---|---|---|---|---|---|---|
| 1 | `src/core/state/slow.ts` | 959 | 5660 | 85% (13% of edit cost) | barrel 92 | 6 | 29 / 57 / 6 |
| 2 | `src/core/scheduler/tiers.ts` | 788 | 4943 | 74% (6% of edit cost) | helper 46, transitive 21, barrel 18, observed 9 | 3 | 48 / 37 / 15 |
| 3 | `src/core/types/runner.ts` | 1504 | 6696 | 100% (5% of edit cost) | barrel 94, setup 6 | 2 | 9 / 77 / 6 |
| 4 | `src/core/revision/reconcile.ts` | 812 | 5128 | 77% (4% of edit cost) | barrel 88, observed 9 | 2 | 48 / 39 / 13 |
| 5 | `src/runners/pytest/environment/states.ts` | 316 | 2363 | 35% (4% of edit cost) | observed 42, transitive 26, helper 14, declared 8, childProcess 5 | 4 | 11 / 12 / 77 |
| 6 | `plugins/claude-code/dist/cli/squeal.mjs` | 15 | 514 | 8% (3% of edit cost) | observed 93, childProcess 6 | 17 | 0 / 0 / 7 |
| 7 | `src/cli/status-wait-groups.ts` | 331 | 1990 | 30% (3% of edit cost) | observed 51, transitive 26, declared 10, helper 5, childProcess 5 | 4 | 8 / 23 / 69 |
| 8 | `src/core/delivery/header.ts` | 715 | 3958 | 59% (3% of edit cost) | barrel 81, observed 12 | 2 | 22 / 59 / 18 |
| 9 | `src/core/types/scheduler.ts` | 1504 | 6696 | 100% (3% of edit cost) | barrel 94, setup 6 | 1 | 62 / 24 / 6 |
| 10 | `src/core/types/store.ts` | 1504 | 6696 | 100% (3% of edit cost) | barrel 79, transitive 9, setup 6, helper 6 | 1 | 66 / 21 / 6 |
| 11 | `src/core/slow/stop-wait.ts` | 989 | 5673 | 85% (2% of edit cost) | barrel 92 | 1 | 23 / 63 / 6 |
| 12 | `src/core/lint/pass/records.ts` | 964 | 5299 | 79% (2% of edit cost) | barrel 70, transitive 13, helper 8 | 1 | 8 / 84 / 9 |

Source files reached: 1509 of 2910; top 25 hold 5% of pair-seconds, top 100 19%. Files re-keying >=50% of the suite: 468, >=25%: 776, >=10%: 938.
Real edits: 971 watch revisions of 1-3 paths; 64 source files edited 137 times; mean re-keyed share per real source edit 27.9%; per source file edited once 16.4%.
