# 004 wave 3 brief: proof

## 004-17 dogfooding on this repository and on cezarion

Outcome: a new `lessons.md` in this spec folder: a verdict against spec 004 goals 1 to 8 with evidence, from real agents working in a repository of each shape with slow files declared, and answers with data to open questions 1 and 2.

Read: spec 004 (goals, D2 to D9, Open questions), `status.md`, `tasks/004-16/notes.md`; spec 003's `lessons.md` as the pattern (003-19).

Two places, both uncommitted configs:
1. This repository: a detached worktree of your own (`git worktree add --detach /tmp/squeal-dogfood-004-<yours> origin/main`), `npm ci`, `npm run build` there (that build is yours; never commit it), and `squeal.config.json` gaining `"slow": { "include": ["test/e2e/**/*.test.ts"] }` with the existing `inputs` that key `test/e2e` by `plugins/**`.
2. Cezarion, as 003-19: `git -C /home/agent/projects/cezar worktree add --detach /tmp/squeal-dogfood-cezarion-004-<yours> HEAD`, `npm ci` and cezar's build, `squeal init`, then `test:package` marked `slow: true` with `inputs` keying it by `packages/cezar/dist/**`. Never edit or commit in `/home/agent/projects/cezar`; remove the worktree with `git -C /home/agent/projects/cezar worktree remove` when done.

The agent: `codex exec -C <worktree>` with the installed Squeal Codex plugin (0.1.56 in the real `~/.codex`, trusted). Two or three small real tasks in each place: one that breaks a fast test and fixes it; one that changes what an e2e file covers, so a rebuild matters; one pause long enough for the slow tier to run. Also `squeal run --slow` once. Never read `~/.codex/auth.json`; never pass `--dangerously-bypass-hook-trust`.

Record per place: whether the edit's fast results arrived before any slow file ran (goal 1); when slow files ran and what triggered them (goal 2); a rebuild re-running them (goal 3); what a slow failure said and when it reached the agent (goal 4); a second worktree inheriting or not (goal 5); every slow-tier line state seen, compared with the truth (goal 6); load-guard notes and deferrals with the load (goal 7); slow-run durations at the load seen, for open question 1; how the idle trigger behaved with the agent's turns, for open question 2. Whether the agent ran e2e itself, and why. Stop every daemon you started. Both repositories' shared stores keep this worktree's results: say so; do not delete them.

Owns: `docs/specifications/004-slow-suites/lessons.md`, throwaway scripts under `docs/specifications/004-slow-suites/research/probes/dogfood/` with a README. No product code: name defects with reproductions, do not fix them. No CPU burners; never delete or kill what you did not start; load here runs 50 to 150.

Done when: `lessons.md` has the verdict, measurements, excerpts and numbered defects; both dogfood worktrees are removed; cezar's main checkout untouched; nothing of yours committed outside `lessons.md` and the probes.

Use /worker.
