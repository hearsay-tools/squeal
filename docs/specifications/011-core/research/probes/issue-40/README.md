# Probe: issue 40 (throwaway)

Throwaway fixture for `../../issue-40.md`. Do not build on it.

`probe.sh <squeal.mjs> <vitest node_modules> <backlogTierSize>` creates a fresh `/tmp/issue40.XXXX` with HOME and XDG_* inside it: 24 two-second background files, three fast files and one slow file (`slow.include`), `baseline.onStart: "lookup-only"`. It queues everything with `run --all`, then a named wait on the fast files and the slow file, and prints the wait's text and the start order each test logs. It starts that repo's own daemon and stops it at the end; output goes to stdout only (the captured runs are quoted in `../../issue-40.md`). Run from outside the worktree: `cd /tmp && bash <abs>/probe.sh <abs>/plugins/claude-code/dist/cli/squeal.mjs <vitest node_modules> 200`, then again with `4`. Remove `/tmp/issue40.*` afterwards.
