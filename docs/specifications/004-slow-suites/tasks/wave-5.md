# 004 wave 5: re-dogfood after waves 4 to 4.7

Decided by the human 2026-10-09: before 004 ships, a short re-dogfood of the fixed slow lane; the 0.1.68 hub release waits for the 001 lane's sixth review.

## 004-46 re-dogfood: the slow lane as it ships now

Outcome: an addendum section in `lessons.md`, "Re-dogfood at 0.1.68", with numbers: whether dogfooding's defects 1, 2, 3, 7 and 8 are gone in real use, and how the parallel slow lane (D2 as amended) behaves. About an hour; this is a check, not a second full dogfood.

Read: `lessons.md` (the first dogfood: setup, defects, timings), spec 004 D2 (as amended), D5, D6, D8, `status.md`'s last lines, `plugins/claude-code/README.md` (loading a checkout's plugin for one session).

The plugin: installs now come from the hub (`squeal@hearsay` 0.1.62), which lacks waves 4 to 4.7. Run the agent sessions with Claude Code loading 0.1.68 from your squeal dogfood worktree for each session: `claude --plugin-dir <absolute path>/plugins/claude-code`, with `{"enabledPlugins": {"squeal@hearsay": false}}` in that session's project `.claude/settings.local.json` (untracked; in the cezar worktree too) so the hub plugin does not also run. Use `--model opus`, never Fable. Never read or copy credentials; never edit `~/.claude` or `~/.codex`.

Places (configs uncommitted, both removed at the end): this repository at `origin/main` in `/tmp/squeal-dogfood2-<yours>`, `npm ci`, `npm run build`, `test/e2e/**` declared slow as in the first dogfood; cezarion as before (`git -C /home/agent/projects/cezar worktree add --detach /tmp/squeal-dogfood2-cezarion-<yours> HEAD`, its build, `squeal init`, `test:package` `slow: true` keyed by `packages/cezar/dist/**`), with the DEFAULT `baseline.onStart` this time. Set `slow.maxLoadPerCpu` high in both (the guard was measured in the first dogfood; say so).

Check, with timestamps and the daemon's notes: (1, defect 1) a `claude -p` session that ends with slow files pending: the daemon drains them before it exits ("drain" notes), within `daemon.idleExitMinutes`. (2, defect 3) cezarion with the default baseline: when the first slow file starts relative to the baseline's start, and that no slow file runs while an edit's fast tier is pending. (3, catch-up) an idle slow tier's width (files at once, up to `slow.maxParallel` 4), the tier's wall time against the first dogfood's (this repository 261 s, cezarion 299 s), and the slow-tier line naming several running files. (4, defect 2) both places' slow tiers overlapping within the per-user permits. (5, defect 7) two cezarion worktrees with different gitignored builds key a slow file differently; equal builds inherit. (6, defect 8) every slow-tier line state seen, against the truth. Also whether the agent ran e2e itself, and why.

Owns: `docs/specifications/004-slow-suites/lessons.md` (an addendum section only) and throwaway scripts under `docs/specifications/004-slow-suites/research/probes/dogfood2/` with a README. No product code: name defects with reproductions, do not fix them. No CPU burners; never delete or kill what you did not start; stop every daemon you start; remove both dogfood worktrees and any extra worktrees; cezar's main checkout untouched.

Done when: the addendum has a verdict per check with evidence and numbered new defects (if any); both places removed.

Use /worker.
