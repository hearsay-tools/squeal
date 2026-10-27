# Process names probe

Throwaway research fixture for row 005-86. It starts no Squeal daemon, harness,
test runner or subject agent. It creates a temporary fake version directory,
seven short-lived Node processes in sequence, and one Node child per case.
It kills and waits for each parent and removes the fixture in `finally`.
The child commands finish synchronously. A 10 s timer bounds each fixture parent.

Run from the repository root on Linux:

```sh
node docs/specifications/005-agent-adoption/research/probes/process-names/probe.mjs
```

Recorded on 2026-10-27, Linux 6.8.0-147-generic:

- `node .../probe.mjs > .../result-node24.json`: exit 0, Node v24.21.0.
- `/home/agent/.nvm/versions/node/v22.19.0/bin/node .../probe.mjs > .../result-node22.json`: exit 0.

The JSON captures `ps -ww -p <pid> -o comm= -o args=`, `/proc/<pid>/cmdline`,
`comm`, the name in `stat`, and the `exe` symlink. Arguments come last in the
`ps` format so that `ps` does not truncate that column. It also captures JS
`argv`, `argv0`, `execPath`, `execArgv` before and after naming, and the child's
launch state. Assertions check unchanged JS state, the child executable,
separate daemon arguments, retention-path visibility, and the short Linux name.

The discovery booleans reproduce only Squeal 0.1.366's name and argument
preconditions. They do not run product discovery or prove locks, ownership or
termination. `discoveryWithNamedComm` adds the exact experimental name to the
existing accepted names; it is evidence for the proposed compatibility change.
The fake project path contains spaces. Results include only the fixture's own
process data, not environment values or other processes.

No interactive monitor session was tested. The report cites htop 3.3.0 and
btop 1.3.0 source for how those tools read these fields. No macOS or Windows
experiment was run.
