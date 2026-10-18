# Probe: issue 34 (throwaway)

Throwaway evidence for `../../issue-34.md`. Not product code; nothing imports it. No build, no `node_modules`, no test suite.

- `run.sh`: runs `probe.mjs` for two scenarios against this checkout's `src/`, loaded through Node 24's `--experimental-transform-types` with `hook.mjs`/`reg.mjs` mapping `.js` imports to `.ts`. `probe.mjs` makes a temp fake repository (`.git/HEAD` only), opens a real store there with `openStore`, appends revisions 1 to 30 and seeds failing known states: `incident` is 38 states observed at revision 24 and `pending` at 30 (the issue's shape); `mixed` is one `current` (observed at 30), two `pending` and one `stale` (observed at 24). It prints `readStatus` counts and known-failure validities, the head of `formatStatus`, and `knownFailuresLine` over the fail states (the line Stop and the hook status text use). The temp directory is deleted.
- `installed.sh`: seeds the `mixed` store with the checkout's code into a temp directory, then reads it with the installed plugin's own CLI (`~/.claude/plugins/cache/hearsay/squeal/0.1.199/bin/squeal status`, `SQUEAL_PLUGIN_BIN=<path>` for another) under a temp `HOME`, and deletes the directory. The `~/.local/bin/squeal` launcher cannot be used under a temp `HOME`: it finds the plugin through `HOME`.

The seeded states have no result rows, so each failure also prints "recorded at an unknown time and load", and the store has no test-file keys, so `Affected checks` says the files are not listed yet. Neither bears on the count.
