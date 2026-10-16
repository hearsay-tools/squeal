# Probe for issue 22 (throwaway)

Throwaway evidence for `../../issue-22.md`; not product code, not a test, never imported.

`node probe.mjs <plugin-root>` builds a scratch Git repository, `HOME` and `XDG_RUNTIME_DIR` under a fresh `/tmp/squeal-issue22-*`, feeds the plugin's own hook bundles (`dist/session-start.mjs`, `post-tool-batch.mjs`, `stop.mjs`, `session-end.mjs`) JSON on stdin as Claude Code would, runs the plugin's CLI for `squeal stop` and `squeal status`, counts daemon processes whose arguments name the scratch root, then stops and kills only those and removes the directory. The driver stays alive throughout, so the hooks record it as the harness process, as a live `claude` would be.

`output-run1.txt`: first run (Stop cycles only). `output-run2.txt`: second run with the PostToolBatch step added; repeated daemon notes filtered out with `grep -v '^      20'`.
