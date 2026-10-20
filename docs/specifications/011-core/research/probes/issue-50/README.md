# Probes for gh-50 (throwaway)

Throwaway. Not product code, not tests. Kept as the record of `../../issue-50.md`.

- `incident-store.cjs`: a read-only query of the cezarion checkout's Squeal store
  for the incident's window. **Run** on 2026-10-20; its output is quoted in the
  findings.
- `probe.sh`: a synthetic restart reproduction in a fresh `mktemp` fixture with
  its own HOME, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME`, `lookup-only`,
  `runner.tierSize: 2`, six held test files on one source. Modes `graceful`
  (SIGTERM to the daemon only) and `group` (SIGTERM to its process group).
  **Not run.** The host's one-minute load stayed between 47 and 65 on 24 CPUs
  for the probe window, and the brief skips live probes above the CPU count.
  It is untested and may need fixes on its first run. It needs
  a directory with `node_modules/vitest` (5.x) and a `squeal.mjs` bundle, e.g.
  `git archive squeal--v0.1.228 plugins/claude-code/dist | tar -x -C <dir>`.
