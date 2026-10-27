# Issue 109 probe (throwaway)

Throwaway evidence for `../../issue-109.md`. Not product code; delete freely.

`probe.sh <squeal.mjs> <claude-code dist dir> [stall s]` with `VITEST_NODE_MODULES` set
to a `node_modules` that holds Vitest. It makes a fixture under `/tmp/issue109-*` with its own
`HOME`, `XDG_RUNTIME_DIR`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, so nothing reaches the real
home or runtime dir. It starts one foreground daemon, registers one Claude Code session through
the committed `session-start.mjs` bundle, then feeds `post-tool-batch.mjs` boundaries on stdin.
It edits a 6 s test, stops the daemon with `SIGSTOP` for the stall (no CPU load), runs
`status --wait` across it, sends `SIGCONT`, and removes the fixture.

The test fails with Vitest's 5 s default timeout. That is a probe artefact and does not
affect the liveness evidence.

`output-0.1.365-sigstop.txt` is the run of 2026-10-27 02:44 UTC.
