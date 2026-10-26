# Research brief 011-256: a browser fixture server outlives Squeal and blocks worker cleanup (gh-107)

Use /researcher. Shape: research. Outcome: who starts the fixture server that survives in a finished worker, why nothing stops it, and how often it happens, as the evidence a fix row is written from.

## Why

Issue #107 has three reports from hearsay-tools/cezarion: 1 of 4, 3 of 20 and 1 of 36 finished report-only workers could not be destroyed. A detached Node fixture server (cwd the worker root, log `.ai/qa/test-env-app.log`, SQLite under `.ai/qa/served/`, parent PID 1049) held each tree after `squeal stop` said "No daemon running". Someone had to kill it by hand. The human approved this research on 2026-10-26.

## Read first

Issue #107 and its comments; 011 C9 (exits, shutdown order), C10 (slow tier), the 2026-10-26 amendment of row 011-245 (processes a cut run leaves); `src/core/daemon/outlived.ts`, `src/core/daemon/run-slow.ts`, the Vitest runner's cancel and teardown path; cezarion's `.ai/scripts/test-env-up.sh` and `test-env-down.sh`, its Vitest browser config and global setup, and cezarion#1448 (e2e servers left running).

## Questions

1. **Who starts it.** Which command starts such a server in a worker: Squeal's slow tier (a browser project's global setup), the agent, or a cezarion script. For any such process on this host, give its age, cwd and whether its environment holds the name `SQUEAL_OBSERVE` (names only).
2. **Why it survives.** On the path that started it, what should stop it (global teardown, `test-env-down.sh`), and which Squeal exit skips that: idle exit, `squeal stop`, a slow run cut by load, a daemon replaced by a newer version, or a signal stop.
3. **How often.** Count such servers and their worktrees on this host now and in the reports, against the workers that ran browser tests.
4. **What Squeal sees.** Whether row 011-245's reading would name it, and what `squeal stop` and `squeal ps` show for it. No design.

## Rules

- Never signal a process you did not start. Read `/proc/<pid>/environ` for variable names only, never values. Never open a live store or socket. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- Experiments run in clones under `/tmp`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and `PLUGIN_DATA` under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA` first. Nice 10, no test suite runs beyond one browser project's file, and give the one-minute load beside every timing. Make no CPU load on purpose.
- Stop everything you started and remove your clones at the end.
- Tag every finding: `verified by experiment`, `read in source code`, `read from store`, `read in official docs` or `inferred`. Budget about one hour.

Own `research/issue-107.md` and `research/probes/issue-107/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 4 each have an answer with tags, and the probe README says how to re-run each experiment. Commit.
