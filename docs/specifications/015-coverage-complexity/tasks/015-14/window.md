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
