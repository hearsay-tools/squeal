# Probes for 015-26, progress updates on a failing function

Throwaway. Not product code. They read the 015-10 part C session logs, which the
worker 4ddd4e37 left under `/tmp/dogfood-015-10/w-4ddd4e37/` (streams and base
files). Nothing here starts a daemon, opens a store or runs an agent session.

- `replay-edits.mts <session dir> <base root> <path> <function>`: applies the
  session's Edit tool calls on `<path>`, in order, to the base copy of the file,
  and counts the file with this worktree's counter (`src/core/code/count`) after
  each. Prints the function's CC and whether its body hash moved. Only Edit calls
  are replayed; a Bash heredoc edit is not.
- `tally.py <sessions dir>`: per session, the `squeal code` calls (and when they
  came relative to the session's complexity lines), the writes per file, and
  the complexity lines delivered.

Run from the worktree root:

```sh
P=docs/specifications/015-coverage-complexity/research/probes/progress-updates
L=/tmp/dogfood-015-10/w-4ddd4e37
node_modules/.bin/tsx $P/replay-edits.mts $L/logs/sessions/sq5 $L/files/base-squeal src/cli/remove.ts removeCommand
node_modules/.bin/tsx $P/replay-edits.mts $L/logs/sessions/cz5r $L/files/base-cezar packages/cezar/src/application-update/discovery.ts discoverInstallation
python3 -I $P/tally.py $L/logs/sessions
```

Outputs, 2026-10-24, counter version 2 at `55afb856a`: `replay-out.txt`, `tally-out.txt`.
