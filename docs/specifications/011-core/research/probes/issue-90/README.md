# Probe for issue 90 (throwaway)

Throwaway evidence for `../../issue-90.md`. It is not product code and not a test. Nothing imports it.

`node probe.mjs <plugin-root> <node_modules>` builds a scratch Git repository, `HOME` and `XDG_RUNTIME_DIR` under a fresh `/tmp/squeal-issue90-*`. The repository copies the shape of the incident's policy: `baseline.onStart: "lookup-only"`, three slow files `e2e/*.e2e.ts` whose declared inputs include `e2e/**/*.{ts,mjs}`, and two fast tests. `node_modules` is a symlink to a checkout's installed dependencies, for Vitest. The probe feeds the plugin's own hook bundles (`dist/session-start.mjs`, `post-tool-batch.mjs`, `session-end.mjs`) JSON on stdin as Claude Code would. It runs the plugin's CLI for `stop`, `start`, `hold`, `run` and `status`. The edits are `sh -c "sed -i …"`, as the Bash tool runs them. At the end it stops and kills only daemons whose arguments name the scratch root, and removes the directory. No real `claude` session runs.

Legs: A, stop with no edit (control). B, stop, one Bash edit, PostToolBatch. C, a second edit while the restarted daemon lives. D, `squeal hold -- sh -c '<edit>; sleep 8'`. E, `squeal hold --max 2m -- sleep 60` in the background, edits from separate calls, then `squeal start`.

`output-0.1.279.txt` and `output-0.1.283.txt`: one run each, from `/tmp`, against `~/.claude/plugins/cache/hearsay/squeal/<version>`.

Captured output has trailing whitespace removed.
