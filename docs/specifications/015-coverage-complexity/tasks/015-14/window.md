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
