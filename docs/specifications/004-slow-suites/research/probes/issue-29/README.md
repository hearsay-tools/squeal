# Issue 29 probe (throwaway)

Throwaway: evidence for `../../issue-29.md`, not a test and not product code.

`probe.sh <plugin-root>...` builds a temp git repository with the reporter's
policy (`slow.include`, `stop.requireSlowSuite: false`,
`stop.requireFullSuite: false`, `baseline.onStart: "lookup-only"`), sets HOME
and XDG_RUNTIME_DIR to temp directories, runs that plugin's `squeal start`
and then its Claude Code `session-start.mjs` hook with a SessionStart payload,
and prints the injected context. It queues no test file, stops the daemon
and deletes the temp tree.

    ./probe.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.199 "$(git rev-parse --show-toplevel)/plugins/claude-code"

`output.txt` is the run recorded in the findings.
