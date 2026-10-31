# Issue 131 launcher probe

Throwaway research fixture. Run from the repository with:

```sh
node docs/specifications/005-agent-adoption/research/probes/issue-131/probe.mjs > docs/specifications/005-agent-adoption/research/probes/issue-131/output.jsonl
```

The script copies the tracked, unchanged launcher to temporary synthetic homes.
It supplies only an allowlisted environment and creates synthetic current records,
session pins and runtime manifests. Each fake runtime CLI prints its version and
arguments. It never runs the product CLI, a daemon, a plugin updater or a test suite.
It never reads or changes real session pins or installed plugins. Temporary homes
are deleted in `finally`. No dependency install or `node_modules` is needed.

Before any launcher call, the script checks that one-minute load does not exceed
CPU count. The saved run used Node 24.22.1, 24 CPUs and load 9.98. Seventeen calls
check data-directory and terminal launchers, unchanged calls, a second session,
a changed current runtime, a blocked marker write, and CODEX_THREAD_ID fallback.

To force a failed notice write without relying on user permissions, the blocked
case makes `launcher-notices.json` a directory. The launcher cannot rename its
new file over that directory, including when the probe runs as root. This proves
the documented persistence-failure fallback, not the reporter's filesystem state.

`output.jsonl` preserves command arguments, exit codes, stdout and stderr. Scratch
prefixes are normalized to `<scratch>`. The final line is an assertion summary,
not JSON. The selected runtime versions 0.1.382–0.1.384 are fixture labels, not
executed runtime bundles. The launcher itself is format 8 from checkout
`e59ed2260d21616ddd529f8a5a5dcf4dde8dc2fc`; its bytes equal release 0.1.383.
