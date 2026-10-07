# Wave 8 briefs

One scan, `--backend claude --model opus --effort high`, never Fable.

## 001-52 quality scan of spec 001

Use /quality.

Outcome: one findings file listing what spec 001 can drop, unify or move, as rows the coordinator pastes into the board unchanged.

Stretch: `935e251..main`, every wave of 001, waves 7 to 7.7 included (targeted invalidation in `src/runners/vitest/stale.ts`, `dynamic.ts`, `graph.ts`; runner-environment failures in `broken.ts`; the daemon's working and temp directories in `src/core/daemon/scratch.ts`, `paths.ts`, `runner.ts`). `reviews/wave-7.7.md` B1 (the temp directory name) is open and awaits the human; do not file it again.

Read: `docs/vision.md`, `docs/styleguide.md`, spec 001 with `status.md`, the reviews under `reviews/`, `lessons.md` defects.

Look especially at: modules past about 300 lines (several tests passed it in waves 7 to 7.7); `notes` contracts added twice (`InvalidateResult.notes`, `RunReport.notes`); path, temp and private-directory helpers spread across `paths.ts`, `scratch.ts` and `src/core/fs`; spec amendments in `status.md` that the code no longer matches.

Own: `docs/specifications/001-core-loop/quality/2026-10.md`, committed alone. Nothing else.

Done when: the file is committed and each finding is a drop candidate, a board row, or a one-sentence slice, with file and line.

## 001-66 research: daemon lifetime under harnesses, and reused worktree paths

Use /researcher. Topic file: `research/daemon-under-harnesses.md`.

Outcome: evidence for two decisions, so Squeal fixes only what any harness can hit and is not shaped around Cezar.

Questions:
1. Who starts a worktree's daemon in a Cezar worker, and does it leave the spawner's process group and session? Read `src/core/daemon/ensure.ts` (`spawn(..., { detached: true })`) and Node's `child_process` docs at the installed Node version; confirm by experiment (pgid, sid of a daemon started from a hook-like parent).
2. Does Cezarion's worker cleanup track that daemon (process group, session, cgroup, descendant walk, or open-handle scan)? Read the installed Cezarion source (`/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/`); experiment if cheap. Same question, from docs only, for Claude Code's own worktree cleanup (`--worktree`, subagent `isolation: worktree`) and `git worktree remove`.
3. Given 1 and 2: with 001-61 and 001-63 landed (`lessons.md` defect 13, D10), which harness behaviours still leave a daemon pinning a removed or retired worktree, and is any of them Cezar-only?
4. `reviews/wave-7.7.md` B1: a different repository creating a worktree at the exact path of a just-removed one within the old daemon's exit window (about 5 s). Which tools name worktree paths so that two repositories can reuse one path: Claude Code worktrees, Cezar, `git worktree add` defaults, Codex or Conductor if their docs say, CI checkouts at fixed paths (e.g. `/home/runner/work/<repo>/<repo>` is per repo; check). Is the case reachable outside a contrived probe?

Own: `docs/specifications/001-core-loop/research/daemon-under-harnesses.md` and `research/probes/daemon-under-harnesses/`. Never edit the board, the spec or product code; never kill or stop daemons you did not start.

Done when every question has a tagged answer or "not determined, because", and the recommendation says for 001-65 (fix or park) and for defect 13 (anything left to do in Squeal), with the tradeoff.
