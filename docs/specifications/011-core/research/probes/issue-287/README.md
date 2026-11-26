# Issue 287: pending inventory

Throwaway probe for `docs/specifications/011-core/research/issue-287.md`.
It seeds a temporary SQLite store through this checkout's store API and runs
the installed **0.1.641** CLI against it. It starts no daemon and runs no tests.
The fixture is removed in `finally`; no dependencies are installed.

From the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-287/probe.ts > docs/specifications/011-core/research/probes/issue-287/output.txt 2>&1
```

The probe checks `/proc/loadavg` against `os.cpus().length` before doing work
and skips when the one-minute load is higher. Each CLI call has a 10 s timeout.
`output.txt` records the successful run on 2026-11-26. Home paths in command
output are replaced with `~`. It is a synthetic inventory reproduction, not a
replay of the original repository's startup or 60 s request timeout.
