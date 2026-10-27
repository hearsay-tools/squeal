# 015-14 dogfood window

The time coverage was switched on, for the dogfood worker (015-14 Part B).

| Repository | Switched on | By | Commit |
|---|---|---|---|
| squeal | 2026-10-24T23:30Z (lands on main with this commit; each worktree from then on, as it takes main) | coordinator 52e58f23 | this commit |

Versions at the switch: squeal 0.1.301 released (tag `squeal--v0.1.301`, hub `086c124`); the installed caches read Claude Code 0.1.300 and Codex 0.1.298, and refresh hours later. 0.1.297 to 0.1.300 judge CRAP and `uncovered` but tell no coverage `STILL FAIL`; 0.1.301 adds 015-40 and R7. Split every count by each session's version, read from its hook paths.

Host load at the switch: 31.09 24.13 23.23 on 24 CPUs.

**Switched off** at 2026-10-25T01:52Z by coordinator 52e58f23, at the request of coordinator 04a258b0: 011-197 (`docs/specifications/011-core/tasks/011-197/findings.md`) found that coverage work on the daemon's main thread delayed a revision by 23.5 minutes in a 0.1.301 tree, and `run --all --wait` then certified the stale revision. Coverage stays off until row 015-42 lands. The window for part B restarts when it is switched on again.

**Switched on again** at 2026-10-25T10:22Z by coordinator 52e58f23, after 0.1.309 was released (agreed with coordinators 04a258b0 and 605ca21e: one re-key, on the code with 015-42, 015-45 and 015-44). Each worktree takes it as it takes main. The window for part B starts here.

Versions at the switch: squeal 0.1.309 released (tag `squeal--v0.1.309`, hub `129fdee`); the installed caches read Claude Code 0.1.309 and Codex 0.1.309. Sessions started before the caches refreshed may still run older hooks: split every count by each session's version, read from its hook paths. Row 015-47 (the seed at a recount or at coverage's start, one turn of about 0.45 s) is not in 0.1.309.

Host load at the switch: 66.27 54.47 51.78 on 24 CPUs.

Watch: the coordinator reads `squeal status` in a busy worktree during the first coverage pass. If 011-200's "Edits since HH:MM:SS may not be seen yet" appears, coverage goes off at once and coordinator 04a258b0 is told.

Switched off again at 2026-10-25T13:55Z by the coordinator (row 015-52): a test file that a pull brought (`test/code/crap/seed.test.ts`, revision 232 of the coordinator's worktree, with 0.1.311) was counted as source before the runner listed it, and its 61 functions were told as `FAIL uncovered`; other test files added the same day were not counted. On again after 015-52 lands and is released.

On again at 2026-10-25T18:10Z by the coordinator, after 0.1.317 (015-52) and 011's 0.1.318 were released; the host's plugin cache holds 0.1.318. A daemon still running a version before 0.1.317 (one on 0.1.314 at the switch) can still count a test file that a pull brought as source until it restarts. Part B's window starts here and runs after a working day; the watch above still applies.

## After the coverage noise fixes

0.1.365 was released on 2026-10-27 at about 02:10 UTC (main/tag dd15be28a, hub 2ceaaf8). It ships 015-78/79/80/81/84/85. This repository still opts into coverage; other projects stay opt-in. This release time is not a measured Round 3 start: sessions and daemons can still use older versions. Split the next counts by the actual hook/daemon version.

0.1.366 was released on 2026-10-27 at about 07:33 UTC (main/tag `06a3d1e54`, hub `4e21d3a`), shipping 015-87. All approved noise fixes are released. Take a read-only baseline now and record actual hook/daemon adoption; a working day of actual coverage-on sessions supplies the final comparable window. Release time alone is not a measured observation start. Its brief is tasks/wave-23.md W2. Keep Round 2 as the before evidence. Do not infer new-version adoption or seven-day retention from release time.

## Round 3 first-stage result, 2026-10-27

The baseline and isolated CPU report are complete in `round-3/notes.md`. The first proven 0.1.366 hook delivery was at 08:00:04 UTC; the first session whose daemon kept running used the hook at 08:23:46 UTC. At the last bounded scan, 08:53 UTC, those sessions had produced no new coverage record or coverage line. Elapsed time without source edits cannot measure usefulness or noise. A 22-hour window would end on 2026-10-28 around 06:00 to 06:25 UTC, but actual source-edit sessions remain required. Split later observations by actual hook and daemon version, including any later release.

The two isolated CPU pairs ended at 11:28 UTC. Coverage on used 1.23 and 1.11 times the CPU off. The pairs failed the agreement rule. Many checks failed in both arms, so the cost goal is not established. No third pair or new experiment is planned. Preserve saved notes before removing each observed worktree. No default recommendation or switch follows from this first stage.

## Interim reading, 2026-10-27

`round-3/interim.md` covers transcripts from 08:23:46 to 11:46:36 UTC (3.38 h), with store reads through 11:54:57 UTC. It has 19 worktree sessions, 5 source-edit sessions and one session with 10 useful coverage lines. It has no Codex source-edit session. Keep 0.1.367 as a separate population. This is a short sample, not the final working-day reading.

The earlier drop-note query was wrong (`notes:%` instead of `notes.%`). Empty `dropNotes` arrays in the three earlier store snapshots are invalid; they cannot support an absence claim. The corrected probe found 16 retained notes in six worktrees; latest totals are 79 dropped payloads. Preserve these notes and record daemon starts before removing observed worktrees. Independent settled-run counts found 33 of 3,046 test-file results without a record at the reading; the cause remains open in proposed row 015-94. No new CPU run is planned.

## Scheduled reading

The human requested the next reading run automatically. One-time automation `2dc5f36a-9a50-4333-a6f2-199f855aac72` is enabled for 2026-10-28 at 06:30 UTC (07:30 Warsaw), using Codex `gpt-6.1-sol` at high effort. It may start up to six hours late if the cockpit was offline. It reads the window from 2026-10-27 at 08:23:46 UTC through its actual observation time, excludes its own activity, and reports missing source-edit sessions or lost notes honestly. It keeps coverage opt-in and does not rerun CPU, alter product settings, or claim seven-day retention.
