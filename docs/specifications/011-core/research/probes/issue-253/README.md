# Issue 253 probe

Throwaway, one-file fixture. Run from the repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-253/probe.py > docs/specifications/011-core/research/probes/issue-253/output.jsonl
```

The retained run used the identical script at its initial staging path,
`research/probes/issue-253/probe.py`, before moving it here.

The script checks `/proc/loadavg` against `os.cpu_count()` before creating
anything. It uses the committed Claude Code runtime, without rebuilding, and
links the checkout's existing dependencies into a temporary Git repository.
It runs only one test file, with one fork worker. After a passing control it
changes that file to write its PID and await an unresolved promise. It checks
the PID's `/proc` working directory and Vitest command line before sending
SIGKILL to that fork alone. It reads status and `why`, restores the original
bytes, and stops only its own daemon with `stop --until-start`. A confirmed stop
removes the fixture. No HOME change, install, existing daemon stop, full suite
or host-wide process signal occurs.

The wait after SIGKILL can request a retry. The retained run did: its new
`runningSince` must not be mistaken for the killed run. The replacement PID
was not captured. Restoring the exact original bytes can reuse the control's
stored pass; the retained output confirms reuse. This is a synthetic failure
injection, not the original incident or a ten-minute observation.

[Sanitized output](output.jsonl) records versions, host/load, commands, exit
codes, durations, full status JSON and failure diagnostic. Paths use
`<fixture>`, `<checkout>` and `~`; no dependencies or fixture data remain.
