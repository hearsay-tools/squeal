# Issue 163 throwaway probe

This is throwaway research code, not a product test or supported tool.
It creates a tiny Git repository and linked worktree in a new temporary directory.
Each case has its own store and user config directory. It configures a private
runtime directory; these runs used the normal `/tmp/squeal-1001/` socket fallback
with a distinct worktree hash because the configured path was long.
No shared daemon or hold is changed. No `node_modules` is needed or committed.
The node:test fixture has one empty test; lookup-only baseline leaves it unrun.

Run from this repository with the installed Node path in `probe.py`:

```sh
python3 research/probes/issue-163/probe.py > research/probes/issue-163/output.jsonl
python3 research/probes/issue-163/probe.py --short-only > research/probes/issue-163/full-output.jsonl
```

The probe checks the one-minute load against the available CPU count before
starting each daemon. It skips a case above that count. It runs the committed
Claude Code CLI bundle directly, with `PI_SESSION_ID=issue-163-cli-only` and no
Pi extension. It records every CLI command, output, selected store rows and
child exit code. It never prints the environment.

The default case reads plain and JSON status, leaves the fixture unchanged for
130 seconds with no Squeal command, then reads both again. It sends SIGTERM to
its own child only **after** this observation and records the cleanup note.
The other case sets `daemon.idleExitMinutes` to 0.05 (3 seconds) and waits
8 seconds. This artificial timeout tests note visibility; it does not reproduce
or explain the original incident's timing.

`output.jsonl` is the first run. While it ran, the script gained a post-observation
`status --full` read and the `--short-only` option. `full-output.jsonl` repeats only
the short case with that read. Both use the same fixture and lifecycle settings.
Temporary repositories are removed after their own child exits. These logs
contain no full-suite run or passing test claim.
