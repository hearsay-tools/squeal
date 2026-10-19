# Probe: issue 45 (throwaway)

Throwaway evidence for `../../issue-45.md`. Not product code; nothing imports it. No build, no `node_modules`, no test suite. `hook.mjs` and `reg.mjs` are copied from `../issue-34/`.

- `run.sh`: prints the one-minute load and CPU count, then runs `probe.mjs` for two scenarios against this checkout's `src/` through Node 24's `--experimental-transform-types`. `probe.mjs` makes a temp fake repository (`.git/HEAD` only), opens a real store with `openStore`, appends revisions 1 to 26, writes `test_file_keys` rows and known states, prints `readStatus` counts and `formatStatus` up to the first blank line, and deletes the directory.
  - `zero`: no failures; 10 test files of 10 passing checks: 6 files stale (key moved, nothing queued), 2 queued, 2 current.
  - `oldrev`: three failures all observed at revision 6 with the worktree at 26: `same-key` current (key unchanged since 6), `moved-key` stale (key moved, not queued), `queued` pending; plus one current pass.
- `installed.sh`: seeds each scenario into a temp directory with the checkout's code, then reads it with the installed plugin CLIs `~/.claude/plugins/cache/hearsay/squeal/{0.1.222,0.1.223}/bin/squeal status` and `status --json` under a temp `HOME` (`SQUEAL_PLUGIN_BINS` overrides), and deletes the directory.

Seeded states carry no result rows, so each failure also prints "recorded at an unknown time and load"; it does not bear on the questions. No `fileLevelCounts` are seeded, so the counts print no "test files loaded" part.
