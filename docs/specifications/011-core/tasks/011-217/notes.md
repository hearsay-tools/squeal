# 011-217: notes (wave 47 W1, 2026-10-26)

Test 3 of `test/scheduler/backlog-slots-overhead.test.ts` now bounds the best slot pass's daemon CPU per file at 5.5 times the best tier pass's, up from 5. Nothing moved the ratio since 011-99. The bound of 5 came from this host at CPU limits and was never measured on CI, where Node 22's shard 3 gives up to 5.00 from the first day.

## Cause

- **The bound was set without CI's values.** 011-99 W2 set 5 from 2.82 to 4.29 on this host, at 2 CPUs and at 4 CPUs with 3 burners. Its review (`reviews/011-99-w2.md`) wrote "CI portability remains unverified".
- **CI's spread is stable.** The test prints its ratio in two jobs: Node 22 shard 3 (the full suite in three shards) and the Node 24 job (only `test/version-sensitive.txt`). Over 28 main runs from 2026-10-22 to 2026-10-26: Node 22 shard 3 gives 3.42 to 5.00 (29 values, one a rerun shard), Node 24 gives 2.45 to 3.38 (28 values). The day means are 4.04 to 4.27 and 3.00 to 3.12. The candidate run of 011-99 W2 itself (39766214199) gave 4.11, and main gave 4.80 on 2026-10-23 (39880282431). The 104 commits to `src/core/scheduler`, `src/core/daemon/node-test-runners.ts` and `src/runners/node-test` since 011-99 landed (`704e5d395..033efba18`) moved no day mean past the noise. Run 40212162098's first attempt gave 5.00 (22.258 ms against 22.253) and failed; its rerun gave 4.11.
- **The shard's other files raise it, not Node 22.** In Node 22 shard 3 the ratio correlates at 0.73 with the best slot pass's wall time (19.5 to 38.4 s) and at 0.69 with its commits (74 to 106). In the Node 24 job, which runs 89 files against the shard's 390, the correlations are 0.05 and -0.20. Alone here, Node 22 gives 3.08 to 3.47 and Node 24 gives 2.70 to 3.56. The slot pass makes 300 runs and 74 to 106 commits; the tier pass makes one run for all 300 files. When other files compete for the 4 vCPUs, slots end farther apart, fewer share a commit, and each run and commit costs more CPU. The last step is inference: no probe measured the CPU of one run or one commit.

No cause is in `src/`, so no row is proposed.

## The bound

5.5 is 10% over CI's highest value (5.00) and under every value that 20 ms more daemon CPU a slot gives:

| Where | Normal | 20 ms more a slot |
| --- | --- | --- |
| CI, Node 22 shard 3 | 3.42 to 5.00 (29) | 7.61 to 10.0, estimated (29) |
| CI, Node 24 job | 2.45 to 3.38 (28) | 5.97 to 9.38, estimated (28) |
| Here alone, Node 24, load 5 to 12 on 24 CPUs | 2.70 to 3.56 (10) | 7.14 to 8.07, measured (4) |
| Here alone, Node 22, load 8 to 12 | 3.08 to 3.47 (5) | not run |
| 011-99, 2 CPUs and 4 CPUs with 3 burners | 2.82 to 4.29 (20) | 6.69 to 7.27, measured |

The CI estimate is each run's best slot CPU plus 20 ms over its best tier CPU, from the printed values. It is low: the measured mutation here also added about 20 commits a pass and took the slot CPU from about 15 to about 39.5 ms a file, not 35. The lowest estimate, 5.97 (run 40142419812, Node 24), is 8% over the bound.

Node 22 shard 3's 30 values (with the 011-99 candidate) have mean 4.16 and standard deviation 0.41. If the spread were normal, about 1 run in 1,900 would exceed 5.5; at 6 it would be 1 in 300,000. 30 values do not confirm the tail.

Not chosen:
- **6.** Fewer false failures, but the Node 24 job's lowest estimate, 5.97, would pass it, and here the margin to 7.14 is 19%.
- **A bound on the difference, slots minus tiers in ms.** It separates better on CI (normal at most 20.3 ms, the mutation at least 29), but it is absolute, and 011-99's brief preferred a ceiling relative to the tier pass, so a slower CPU moves both.
- **Run the file alone after its shard**, as `opencode-dispose.test.ts` is. That removes the cause on CI, but `.github/workflows/ci.yml` is not this row's. It is an input for the coordinator if 5.5 fails again.

## Evidence

CI: `gh run view <id> --log` (`--attempt 1` for 40212162098), the line `011-21 slots: 300 files at ...`. The ten runs the brief names are the last ten (40249129483 to 40273932384): Node 22 shard 3 3.42 to 4.94, Node 24 2.73 to 3.38, all under 5.5.

| Run | Started (UTC) | Commit | Job | Best ratio | Slot passes: CPU ms a file, wall, commits | Tier passes: CPU ms a file, wall |
| --- | --- | --- | --- | --- | --- | --- |
| 39766214199 | 2026-10-22 10:51 | b428e4308 (cand/011-99-w2) | Node 22 (3/3) | 4.11 | 23.3 in 37.2 s, 96 commits; 21.9 in 29.3 s, 91 commits | 5.7 in 34.2 s; 5.3 in 31.1 s |
| 39766214199 | 2026-10-22 10:51 | b428e4308 (cand/011-99-w2) | Node 24 | 2.98 | 14.9 in 19.6 s, 74 commits; 13.0 in 16.4 s, 68 commits | 4.8 in 20.8 s; 4.4 in 13.6 s |
| 39792397094 | 2026-10-22 14:03 | 415e0c8eb | Node 22 (3/3) | 3.76 | 17.6 in 27.4 s, 90 commits; 17.1 in 22.0 s, 76 commits | 4.5 in 25.3 s; 4.7 in 22.6 s |
| 39792397094 | 2026-10-22 14:03 | 415e0c8eb | Node 24 | 2.45 | 15.3 in 20.2 s, 75 commits; 11.1 in 17.7 s, 73 commits | 5.7 in 22.7 s; 4.5 in 13.4 s |
| 39880282431 | 2026-10-23 00:48 | c6de2a061 | Node 22 (3/3) | 4.80 | 22.9 in 36.4 s, 101 commits; 22.9 in 30.0 s, 89 commits | 5.3 in 35.6 s; 4.8 in 31.8 s |
| 39880282431 | 2026-10-23 00:48 | c6de2a061 | Node 24 | 3.07 | 20.6 in 23.8 s, 80 commits; 16.3 in 20.2 s, 75 commits | 6.2 in 25.4 s; 5.3 in 17.6 s |
| 39943943688 | 2026-10-23 11:08 | 8fe47ab71 | Node 22 (3/3) | 3.95 | 25.5 in 38.8 s, 104 commits; 21.5 in 30.0 s, 89 commits | 5.4 in 37.1 s; 5.6 in 33.6 s |
| 39943943688 | 2026-10-23 11:08 | 8fe47ab71 | Node 24 | 3.07 | 14.6 in 20.3 s, 75 commits; 10.0 in 18.4 s, 73 commits | 4.3 in 22.3 s; 3.2 in 13.7 s |
| 39968340105 | 2026-10-23 14:17 | 78422b08b | Node 22 (3/3) | 4.38 | 25.9 in 39.2 s, 109 commits; 25.6 in 31.2 s, 93 commits | 5.9 in 38.1 s; 5.8 in 34.6 s |
| 39968340105 | 2026-10-23 14:17 | 78422b08b | Node 24 | 3.15 | 15.5 in 20.0 s, 76 commits; 12.7 in 16.9 s, 67 commits | 4.8 in 20.1 s; 4.0 in 12.7 s |
| 40013122863 | 2026-10-23 19:39 | e90e0030c | Node 22 (3/3) | 3.92 | 15.3 in 25.0 s, 83 commits; 15.4 in 21.6 s, 74 commits | 3.9 in 22.7 s; 4.3 in 23.2 s |
| 40013122863 | 2026-10-23 19:39 | e90e0030c | Node 24 | 2.73 | 20.0 in 23.4 s, 78 commits; 14.7 in 20.1 s, 75 commits | 6.6 in 25.9 s; 5.4 in 17.4 s |
| 40052812099 | 2026-10-24 02:07 | 1cea53659 | Node 22 (3/3) | 4.31 | 23.6 in 36.8 s, 100 commits; 23.5 in 31.2 s, 95 commits | 5.5 in 34.6 s; 5.6 in 32.8 s |
| 40052812099 | 2026-10-24 02:07 | 1cea53659 | Node 24 | 3.37 | 20.8 in 24.0 s, 80 commits; 17.0 in 20.2 s, 75 commits | 6.0 in 26.2 s; 5.0 in 17.3 s |
| 40077710759 | 2026-10-24 08:21 | c8ec6fdc2 | Node 22 (3/3) | 4.03 | 24.5 in 40.9 s, 112 commits; 22.6 in 34.9 s, 98 commits | 5.6 in 26.6 s; 5.6 in 30.3 s |
| 40077710759 | 2026-10-24 08:21 | c8ec6fdc2 | Node 24 | 3.03 | 24.7 in 27.5 s, 88 commits; 17.2 in 20.4 s, 75 commits | 6.2 in 33.3 s; 5.7 in 21.3 s |
| 40089777714 | 2026-10-24 11:24 | 39bca22e7 | Node 22 (3/3) | 3.74 | 20.1 in 33.6 s, 96 commits; 17.0 in 27.7 s, 88 commits | 4.7 in 20.7 s; 4.5 in 23.6 s |
| 40089777714 | 2026-10-24 11:24 | 39bca22e7 | Node 24 | 2.89 | 24.4 in 27.0 s, 88 commits; 17.1 in 20.4 s, 75 commits | 6.1 in 33.7 s; 5.9 in 20.7 s |
| 40101221471 | 2026-10-24 14:09 | 9b48fa424 | Node 22 (3/3) | 3.66 | 17.7 in 29.6 s, 92 commits; 15.7 in 24.9 s, 82 commits | 4.3 in 18.0 s; 4.3 in 21.2 s |
| 40101221471 | 2026-10-24 14:09 | 9b48fa424 | Node 24 | 3.05 | 21.5 in 25.3 s, 82 commits; 14.0 in 19.7 s, 75 commits | 5.1 in 30.4 s; 4.6 in 19.1 s |
| 40116509121 | 2026-10-24 17:31 | d7b1755b9 | Node 22 (3/3) | 4.47 | 24.7 in 39.7 s, 109 commits; 23.6 in 37.4 s, 106 commits | 5.3 in 27.0 s; 6.3 in 30.6 s |
| 40116509121 | 2026-10-24 17:31 | d7b1755b9 | Node 24 | 2.89 | 24.0 in 26.1 s, 84 commits; 16.3 in 20.1 s, 75 commits | 5.9 in 32.0 s; 5.6 in 20.3 s |
| 40134604171 | 2026-10-24 21:31 | a3f6f04ef | Node 22 (3/3) | 4.10 | 21.4 in 35.9 s, 103 commits; 17.9 in 31.0 s, 93 commits | 4.4 in 23.4 s; 4.5 in 27.4 s |
| 40134604171 | 2026-10-24 21:31 | a3f6f04ef | Node 24 | 3.05 | 19.4 in 26.7 s, 82 commits; 14.6 in 22.5 s, 74 commits | 4.9 in 25.5 s; 4.8 in 17.9 s |
| 40142419812 | 2026-10-24 23:21 | 6f0e026b4 | Node 22 (3/3) | 4.00 | 17.4 in 31.8 s, 94 commits; 15.9 in 27.1 s, 86 commits | 4.0 in 20.3 s; 4.3 in 24.4 s |
| 40142419812 | 2026-10-24 23:21 | 6f0e026b4 | Node 24 | 2.71 | 25.7 in 29.0 s, 87 commits; 16.4 in 20.4 s, 75 commits | 6.3 in 32.8 s; 6.1 in 20.7 s |
| 40153853975 | 2026-10-25 02:16 | 62543ed38 | Node 22 (3/3) | 4.64 | 27.3 in 41.5 s, 109 commits; 25.8 in 38.4 s, 105 commits | 5.8 in 27.4 s; 5.6 in 31.2 s |
| 40153853975 | 2026-10-25 02:16 | 62543ed38 | Node 24 | 2.94 | 17.0 in 21.8 s, 77 commits; 12.5 in 18.7 s, 71 commits | 4.5 in 24.4 s; 4.2 in 16.4 s |
| 40185777631 | 2026-10-25 10:41 | 027a01c75 | Node 22 (3/3) | 3.50 | 13.9 in 21.1 s, 77 commits; 13.8 in 20.2 s, 76 commits | 4.0 in 16.7 s; 4.0 in 22.3 s |
| 40185777631 | 2026-10-25 10:41 | 027a01c75 | Node 24 | 3.04 | 26.2 in 29.9 s, 93 commits; 17.9 in 20.5 s, 75 commits | 6.1 in 33.0 s; 5.9 in 20.4 s |
| 40212162098 attempt 1 | 2026-10-25 16:32 | 5e6db0071 | Node 22 (3/3) | 5.00 | 22.3 in 35.0 s, 97 commits; 22.3 in 29.1 s, 88 commits | 4.5 in 25.6 s; 4.6 in 29.7 s |
| 40212162098 attempt 2 | 2026-10-25 16:32 | 5e6db0071 | Node 22 (3/3) | 4.11 | 18.2 in 25.9 s, 83 commits; 16.6 in 21.4 s, 76 commits | 4.1 in 20.3 s; 4.3 in 24.4 s |
| 40212162098 attempt 2 | 2026-10-25 16:32 | 5e6db0071 | Node 24 | 2.85 | 24.7 in 29.2 s, 88 commits; 16.8 in 20.3 s, 75 commits | 6.0 in 30.3 s; 5.9 in 19.1 s |
| 40214708998 | 2026-10-25 17:04 | 0e9e236d8 | Node 22 (3/3) | 3.88 | 18.8 in 30.7 s, 94 commits; 16.5 in 26.0 s, 84 commits | 4.2 in 22.4 s; 4.3 in 25.5 s |
| 40214708998 | 2026-10-25 17:04 | 0e9e236d8 | Node 24 | 3.06 | 24.9 in 28.9 s, 90 commits; 16.2 in 20.2 s, 75 commits | 5.8 in 29.9 s; 5.3 in 18.9 s |
| 40233841099 | 2026-10-25 21:05 | e42139eee | Node 22 (3/3) | 4.22 | 24.6 in 38.4 s, 108 commits; 22.0 in 32.0 s, 94 commits | 5.2 in 28.0 s; 5.9 in 32.8 s |
| 40233841099 | 2026-10-25 21:05 | e42139eee | Node 24 | 3.25 | 25.3 in 28.9 s, 91 commits; 18.2 in 20.5 s, 75 commits | 6.0 in 30.2 s; 5.6 in 19.0 s |
| 40240677277 | 2026-10-25 22:32 | 583f46553 | Node 22 (3/3) | 3.58 | 19.3 in 36.1 s, 91 commits; 16.5 in 29.1 s, 87 commits | 4.6 in 22.2 s; 4.7 in 27.3 s |
| 40240677277 | 2026-10-25 22:32 | 583f46553 | Node 24 | 3.25 | 18.3 in 31.0 s, 82 commits; 13.2 in 26.6 s, 76 commits | 4.3 in 24.0 s; 4.1 in 17.1 s |
| 40249129483 | 2026-10-26 00:23 | cd00e8c43 | Node 22 (3/3) | 4.94 | 25.7 in 38.6 s, 106 commits; 25.4 in 33.1 s, 91 commits | 5.1 in 28.3 s; 6.8 in 33.5 s |
| 40249129483 | 2026-10-26 00:23 | cd00e8c43 | Node 24 | 2.98 | 25.7 in 29.6 s, 91 commits; 17.5 in 20.5 s, 75 commits | 5.9 in 30.7 s; 6.6 in 19.6 s |
| 40250531932 | 2026-10-26 00:40 | fedfa9ed8 | Node 22 (3/3) | 4.27 | 24.6 in 39.1 s, 102 commits; 23.2 in 32.5 s, 95 commits | 5.4 in 29.1 s; 5.5 in 32.4 s |
| 40250531932 | 2026-10-26 00:40 | fedfa9ed8 | Node 24 | 3.38 | 13.7 in 19.9 s, 76 commits; 13.0 in 14.7 s, 62 commits | 4.4 in 18.9 s; 3.8 in 14.1 s |
| 40255393361 | 2026-10-26 01:40 | c7e9ab007 | Node 22 (3/3) | 4.34 | 16.2 in 27.3 s, 89 commits; 15.1 in 22.4 s, 79 commits | 3.8 in 20.7 s; 3.5 in 26.3 s |
| 40255393361 | 2026-10-26 01:40 | c7e9ab007 | Node 24 | 3.06 | 24.7 in 28.8 s, 93 commits; 16.5 in 20.2 s, 75 commits | 5.8 in 30.0 s; 5.4 in 18.8 s |
| 40255633641 | 2026-10-26 01:43 | d059311a6 | Node 22 (3/3) | 4.29 | 24.5 in 38.3 s, 104 commits; 21.5 in 30.6 s, 91 commits | 5.0 in 27.5 s; 5.5 in 32.5 s |
| 40255633641 | 2026-10-26 01:43 | d059311a6 | Node 24 | 3.17 | 22.2 in 26.6 s, 85 commits; 14.5 in 19.9 s, 75 commits | 4.7 in 27.6 s; 4.6 in 17.9 s |
| 40257847142 | 2026-10-26 02:11 | edb3bd99a | Node 22 (3/3) | 3.94 | 16.4 in 25.1 s, 83 commits; 15.0 in 21.6 s, 77 commits | 4.0 in 20.3 s; 3.8 in 24.4 s |
| 40257847142 | 2026-10-26 02:11 | edb3bd99a | Node 24 | 3.00 | 24.8 in 29.5 s, 89 commits; 17.6 in 20.2 s, 75 commits | 6.1 in 31.3 s; 5.9 in 19.3 s |
| 40259459911 | 2026-10-26 02:30 | ae7c7dc51 | Node 22 (3/3) | 4.74 | 23.9 in 39.7 s, 104 commits; 21.5 in 33.0 s, 95 commits | 4.5 in 25.7 s; 5.2 in 31.6 s |
| 40259459911 | 2026-10-26 02:30 | ae7c7dc51 | Node 24 | 3.30 | 17.5 in 22.8 s, 79 commits; 11.8 in 19.0 s, 74 commits | 4.1 in 23.7 s; 3.6 in 16.4 s |
| 40268130949 | 2026-10-26 04:15 | 219879482 | Node 22 (3/3) | 4.22 | 25.2 in 40.8 s, 108 commits; 22.4 in 32.4 s, 92 commits | 5.3 in 27.1 s; 5.7 in 32.8 s |
| 40268130949 | 2026-10-26 04:15 | 219879482 | Node 24 | 2.73 | 24.9 in 28.7 s, 87 commits; 16.1 in 20.4 s, 75 commits | 6.1 in 30.0 s; 5.9 in 20.8 s |
| 40268910480 | 2026-10-26 04:24 | 9c194e5eb | Node 22 (3/3) | 4.09 | 25.0 in 40.6 s, 106 commits; 21.9 in 32.5 s, 92 commits | 5.4 in 27.2 s; 5.3 in 31.8 s |
| 40268910480 | 2026-10-26 04:24 | 9c194e5eb | Node 24 | 3.29 | 26.2 in 30.1 s, 93 commits; 19.9 in 20.8 s, 75 commits | 6.1 in 30.7 s; 6.0 in 20.5 s |
| 40271248410 | 2026-10-26 04:52 | 7ee4e26b5 | Node 22 (3/3) | 3.42 | 14.7 in 23.0 s, 80 commits; 13.6 in 19.5 s, 74 commits | 4.0 in 17.6 s; 4.4 in 22.7 s |
| 40271248410 | 2026-10-26 04:52 | 7ee4e26b5 | Node 24 | 2.95 | 25.8 in 29.3 s, 89 commits; 17.7 in 20.5 s, 75 commits | 6.0 in 29.4 s; 6.1 in 19.8 s |
| 40273932384 | 2026-10-26 05:23 | 22fb59fa5 | Node 22 (3/3) | 4.49 | 25.8 in 41.8 s, 112 commits; 23.7 in 35.6 s, 97 commits | 5.3 in 27.2 s; 5.7 in 32.4 s |
| 40273932384 | 2026-10-26 05:23 | 22fb59fa5 | Node 24 | 3.30 | 23.2 in 27.8 s, 85 commits; 16.8 in 20.5 s, 75 commits | 5.5 in 28.9 s; 5.1 in 19.4 s |

Here: the file alone, `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run --reporter=default test/scheduler/backlog-slots-overhead.test.ts` in a `git archive` copy of `033efba18` (outside the worktree, so its daemon did not run beside it), one run after another, no burners. Load is the 1-minute average on 24 CPUs. Vitest's agent reporter hides a passing test's output, so `--reporter=default` is needed to see the line.

| Series | Run | Node | Load before / after (1 min) | Best ratio | Slot passes: CPU ms a file, wall, commits | Tier passes: CPU ms a file, wall | Exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Alone | 1 | v24.21.0 | 6.37 / 8.21 | 3.21 | 15.1 in 19.0 s, 75 commits; 16.7 in 19.1 s, 75 commits | 5.1 in 16.1 s; 4.7 in 15.7 s | 0 |
| Alone | 2 | v24.21.0 | 8.21 / 7.95 | 2.99 | 14.4 in 18.8 s, 75 commits; 16.1 in 19.1 s, 75 commits | 4.8 in 15.6 s; 5.6 in 16.1 s | 0 |
| Alone | 3 | v24.21.0 | 7.95 / 8.89 | 2.98 | 16.4 in 19.2 s, 75 commits; 15.9 in 18.9 s, 75 commits | 5.4 in 16.5 s; 5.3 in 16.3 s | 0 |
| Alone | 4 | v24.21.0 | 8.89 / 8.78 | 3.16 | 15.6 in 19.0 s, 75 commits; 15.2 in 18.9 s, 75 commits | 4.8 in 15.7 s; 5.0 in 16.5 s | 0 |
| Alone | 5 | v24.21.0 | 8.78 / 6.45 | 2.70 | 14.2 in 18.8 s, 75 commits; 13.3 in 18.8 s, 75 commits | 5.0 in 15.7 s; 4.9 in 15.3 s | 0 |
| Alone | 6 | v24.21.0 | 6.45 / 6.30 | 2.96 | 14.0 in 18.9 s, 75 commits; 13.3 in 18.7 s, 75 commits | 4.7 in 15.3 s; 4.5 in 15.2 s | 0 |
| Alone | 7 | v24.21.0 | 6.30 / 5.26 | 3.03 | 14.8 in 18.9 s, 75 commits; 13.9 in 18.8 s, 75 commits | 4.9 in 15.7 s; 4.6 in 15.4 s | 0 |
| Alone | 8 | v24.21.0 | 5.26 / 10.22 | 3.32 | 20.3 in 19.9 s, 76 commits; 19.3 in 20.2 s, 77 commits | 5.8 in 18.3 s; 6.2 in 16.8 s | 0 |
| Alone | 9 | v24.21.0 | 10.22 / 12.24 | 3.33 | 18.8 in 19.9 s, 77 commits; 21.5 in 21.3 s, 80 commits | 5.6 in 17.6 s; 6.3 in 18.4 s | 0 |
| Alone | 10 | v24.21.0 | 12.24 / 12.01 | 3.56 | 18.1 in 19.6 s, 76 commits; 17.4 in 19.2 s, 75 commits | 5.7 in 17.2 s; 4.9 in 16.3 s | 0 |
| Alone | 1 | v22.23.3 | 11.79 / 9.70 | 3.37 | 15.3 in 18.9 s, 75 commits; 15.6 in 19.2 s, 75 commits | 5.2 in 16.0 s; 4.5 in 15.5 s | 0 |
| Alone | 2 | v22.23.3 | 9.70 / 10.62 | 3.47 | 17.4 in 19.3 s, 75 commits; 17.1 in 19.4 s, 75 commits | 5.4 in 16.4 s; 4.9 in 15.8 s | 0 |
| Alone | 3 | v22.23.3 | 10.62 / 10.50 | 3.29 | 15.6 in 19.0 s, 75 commits; 15.6 in 19.1 s, 75 commits | 5.2 in 15.8 s; 4.7 in 15.5 s | 0 |
| Alone | 4 | v22.23.3 | 10.50 / 8.34 | 3.08 | 17.3 in 19.3 s, 75 commits; 14.8 in 19.0 s, 75 commits | 5.7 in 16.9 s; 4.8 in 15.9 s | 0 |
| Alone | 5 | v22.23.3 | 8.34 / 7.99 | 3.16 | 15.2 in 19.0 s, 75 commits; 14.0 in 18.8 s, 75 commits | 4.9 in 15.5 s; 4.4 in 15.1 s | 0 |
| 20 ms a slot, bound 5 | 1 | v24.21.0 | 11.19 / 12.48 | 7.45 | 39.9 in 25.1 s, 96 commits; 39.7 in 24.6 s, 96 commits | 5.3 in 16.8 s; 6.1 in 17.3 s | 1 |
| 20 ms a slot, bound 5 | 2 | v24.21.0 | 12.48 / 10.45 | 7.42 | 40.0 in 26.7 s, 97 commits; 40.0 in 26.6 s, 95 commits | 5.7 in 17.2 s; 5.4 in 17.0 s | 1 |
| 20 ms a slot, bound 5 | 3 | v24.21.0 | 10.45 / 11.79 | 7.14 | 41.7 in 25.1 s, 95 commits; 39.1 in 24.5 s, 96 commits | 5.5 in 16.8 s; 5.5 in 17.0 s | 1 |
| 20 ms a slot, bound 5.5 | 1 | v24.21.0 | 8.12 / 9.58 | 8.07 | 39.2 in 24.4 s, 96 commits; 39.4 in 24.3 s, 95 commits | 5.3 in 16.7 s; 4.9 in 16.1 s | 1 |

The mutation, in the scratch copy only: `test/scheduler/timed-runner.ts` spins until the process has used 20 ms more CPU (`process.cpuUsage()`) in each `run` call, before it calls the runner. A slot is one call per file; a tier is one call for 300 files. The run against the new bound:

```
011-21 slots: 300 files at 39.2 ms CPU a file in 24444 ms, 300 runs and 96 commits; 39.4 ms CPU a file in 24331 ms, 300 runs and 95 commits; one tier at 5.3 ms CPU a file in 16658 ms, 1 runs; 4.9 ms CPU a file in 16063 ms, 1 runs (best 8.07 times)
 ❯ test/scheduler/backlog-slots-overhead.test.ts (1 test | 1 failed) 82765ms
     × 3. runs 300 files of about 50 ms at most 5.5 times a tier's daemon CPU per file, with fewer commits than files 82764ms
AssertionError: expected 39.24191333333334 to be less than or equal to 26.735903333333326
 ❯ test/scheduler/backlog-slots-overhead.test.ts:98:28
     98|     expect(bestCpu(slots)).toBeLessThanOrEqual(bestCpu(tiers) * 5.5);
 Test Files  1 failed (1)
```

The commit budget passed in every mutation run (95 to 97 commits against 180).

## Commits

- `95134d31a` test(011-217): the bound is 5.5, the comment gives the spread on CI and here.
- This notes file.
