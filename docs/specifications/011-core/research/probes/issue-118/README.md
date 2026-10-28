# Issue 118 probe (throwaway)

Run from the repository root with dependencies already installed:

```sh
python3 docs/specifications/011-core/research/probes/issue-118/probe.py
```

The probe checks host load before each command. It skips commands when the
one-minute load exceeds the CPU count. It reads installed CLI output and calls
the source's `fileEntry` formatter with a synthetic current/pass entry. It starts
no tests, edits no runtime inputs and changes no hold. The status command can ask
an existing daemon to sync its observations. It does not request a test run.

`evidence.json` is the captured output. Status stdout is deliberately projected
to the revision, daemon, open-run count and complete selection; unrelated global
status data is omitted. The synthetic formatter call proves the output shape,
not a live current result or scheduler behavior.
