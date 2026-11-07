# Issue 158 throwaway probe

This is a throwaway research fixture, not a product regression test. Run from the repository root with its installed dependencies:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-158/probe.ts > docs/specifications/011-core/research/probes/issue-158/output.jsonl 2> docs/specifications/011-core/research/probes/issue-158/probe-stderr.txt
```

The script records host load and skips all cases when one-minute load exceeds the logical CPU count. It creates a separate `/tmp/sq158-*/repo` Git repository, store and private socket directory for each case. The source store API creates the schema and worktree row. A separate SQLite connection holds `BEGIN IMMEDIATE`; it rolls back after the CLI exits, or 500 ms after the stand-in receives `stop` in the transient case. The persisted mark is read with `SELECT value FROM meta WHERE key = ?`, using `stoppedMetaKey(worktreeIdFor(root))`, before the lock and after its rollback.

The CLI is a real child process running the committed bundle. An optional first argument selects another CLI bundle. Its environment contains only `PATH=/usr/bin:/bin` and the fixture's `XDG_RUNTIME_DIR`. No real Squeal daemon starts. The stand-in answers ping and stop, then closes its socket. Its PID is an absent sentinel, 2147483647, and it has no process group, children or daemon record. Thus this probe proves the mark-write and CLI outcome paths, not real-daemon cancellation or shutdown timing. A fourth case has no socket at all. Each CLI child has a 15-second watchdog. Cleanup releases the fixture lock, closes the socket and removes the temporary repository.

`output.jsonl` preserves exact child argv, cwd, environment, output, exit status, elapsed time, requests and stored marks. `probe-stderr.txt` is empty in the recorded run. The outer command exited 0. The data is from Squeal 0.1.414 on Node v24.22.1; see the report for commit and bundle identity. No dependencies or databases are committed.
