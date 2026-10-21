# Brief: which layer deletes an old plugin version a live session still names (005-72)

The human, 2026-10-21, triage round 9, group E: one researcher first, before choosing kept versioned assets or stable entry points.

Use /researcher. Shape: research. Read board row 005-72; `research/issue-48.md`; `011-core/research/issue-70.md` (gh-70, proposed: the same deletion under a live tier, the recorder's assets); spec 005 D3 and D6, 002 D1; row 009-18 (Pi's loaded version, done) for prior art. Base: main at or after the commit that adds this brief.

Outcome: for Claude Code and Codex, which component deletes `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>` (and Codex's equivalent) when a newer version installs, on what trigger, and what a session that started on the old version can still reach.

Questions:
1. The deleting layer and its trigger in each harness: install, update, session start, a cleanup pass, or a marketplace refresh. Evidence from published docs and source (Codex is open source; Claude Code's npm package as text only).
2. What survives: the old directory, the skill catalog's paths, the primer's absolute CLI path, the recorder's `--require` and `NODE_OPTIONS` paths a running tier's children read (gh-70).
3. The options, each with its cost: keep the last N versions (who owns pruning), stable entry points (a version-free launcher or a symlink the plugin controls), or a session that re-reads the catalog.
4. The regression a code row needs: the steps of a session spanning an upgrade, and where a test can stand in for the harness.

Isolation: no execution of `claude`, `codex` or any plugin install as this user. A live upgrade runs only as the throwaway user `squeal-e2e` (`sudo -n -u squeal-e2e -H env -i ...`, cwd `/`), with credentials passed by name only, and only at a one-minute load below 24; otherwise docs and source only. Never run or import a repository script to check it. Owns `research/plugin-cache-cleanup.md`, `research/probes/plugin-cache-cleanup/`. Not yours: product code, spec text, `status.md`, the board.

Done when the findings file answers 1 to 4 with evidence tags, gives the load beside any live number, and ends with one recommendation and the code row's done-when as tests.
