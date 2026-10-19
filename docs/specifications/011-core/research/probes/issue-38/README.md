# Probe: issue 38 (throwaway)

Throwaway fixture for `../../issue-38.md`. Do not build on it.

`probe.sh <squeal.mjs> <vitest node_modules>` creates a fresh `/tmp/issue38.XXXX` with HOME and XDG_* inside it. In it, a git repo has three Vitest files and `baseline.onStart: "lookup-only"`. The script starts that repo's own daemon and stops it at the end. Its output goes to stdout only; no output file is committed. Run it from outside the worktree, e.g. `cd /tmp && bash <abs>/probe.sh <abs>/plugins/claude-code/dist/cli/squeal.mjs <abs>/node_modules`. Remove `/tmp/issue38.*` afterwards.
