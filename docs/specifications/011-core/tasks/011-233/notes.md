# 011-233 notes (wave 46 W1, researcher c2aa9693, 2026-10-26)

Findings: `research/source-path-selection.md`; probes: `research/probes/source-path-selection/`.

Cause. A source path selects a test file only when the file's one shared closure record (`test_files`, stored once per test file for every worktree) was written by this worktree, or by a worktree whose *current* key for the file is this worktree's (`validClosures`, `src/cli/named-selection.ts:143`). Many worktrees write those records (42 git worktrees of this repository on the host; results inherited from 21). The selection changes when any of them stores a closure, edits a file in it, moves to another commit, or is pruned (prune deletes the writer's keys, not its records). The worktree's own edit adds a short window, until its runner part stores the re-keyed closures. The edit cut writes no closure. Imports through a helper are in the closure.

Evidence. A fixture store: 13 readers of `start.ts` selected 13, 0, 13, 0, 3, 5, 13, 0, 13, 0 across ten store writes. A wait on `start.ts` exits 0 while an unselected reader fails at this worktree's key, and exits 0 after 1.0 s while one is queued. Live, in this worktree, which edited nothing a test reads: `start.ts` selected 134, then 3, then 187 within 10 minutes. `start-spawned.test.ts` was in none of the 20 samples. `src/cli/main.ts`, imported by value by 65 test files, selected 0 and then 184.

Fix row proposed. A source path selects from the daemon's own reverse index; the store rule stays as the fallback when no daemon is running. It needs an amendment to 005 D2.

Commits: listed in the final report.
