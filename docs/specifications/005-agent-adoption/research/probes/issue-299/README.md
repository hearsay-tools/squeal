# Issue 299 launcher probe

Throwaway, launcher-only research fixture. It copies the current repository's
launcher and creates stub CLIs for Claude Code 0.1.654, Codex 0.1.647 and
Antigravity 0.1.640. The stubs print selected version and arguments; no real
status, lint, daemon or tests run. It changes no host plugin, pin or marker.

Run from the repository root:

```sh
python3 docs/specifications/005-agent-adoption/research/probes/issue-299/probe.py > docs/specifications/005-agent-adoption/research/probes/issue-299/output.jsonl
```

The script checks `/proc/loadavg` against `os.cpu_count()` before its fixture and
each call, runs three separate launcher processes with writable state and three
with a directory blocking the marker rename, and removes the fixture at exit.
Its child environment contains only explicit isolated home/config/data/cache
paths, a Node PATH and a synthetic Claude Code session ID. Output records both
streams, exit codes, arguments, load and marker state. `<fixture>` replaces the
temporary absolute path in the command and marker labels.

Captured 2026-11-27: load 1.44 / 16 CPUs, Node 26.13.0, launcher format 10,
identical bytes in release 0.1.654 and research checkout 0.1.655. Writable state
warned on call 1 only; blocked state warned on all three. All warnings were on
stderr and all six calls exited 0. This does not reproduce the reporting
session's environment or execute its validation commands.
