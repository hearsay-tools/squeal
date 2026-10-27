# Issue 111 probe (throwaway)

Throwaway research evidence, outside the product test suite. Run from the repository root:

```sh
python3 docs/specifications/011-core/research/probes/issue-111/probe.py > docs/specifications/011-core/research/probes/issue-111/output.txt 2>&1
```

Requires the already installed Node, Vitest and Python 3. Installs nothing.
Checks one-minute load against CPU count before starting a daemon; skips when above it.
Creates a temporary Git repository with two real Vitest files and a symlink to this
checkout's `node_modules`. Neither dependencies nor generated fixtures enter Git.
Uses the checkout's committed 0.1.365 Claude Code CLI bundle with no product edits or rebuild. Coverage, complexity and runtime
input observation are off in this fixture. The baseline runs only its two files.

The fast file passes immediately. The slow file writes a start marker and waits
for a release marker (25 s maximum, below its 30 s test timeout). The script waits
for an ended count of one, asserts that both named JSON entries are still pending
with the same `ended: 1`, and confirms the slow file has not ended. It requests
one-second waits for both files and for the fast file alone; each must exit 3.
It then releases the slow file and requires a current verdict for both (exit 0).
The script terminates its own daemon and removes its temporary repository.
It does not stop, restart or change a real project's daemon.

`output.txt`: final successful run, 2026-10-27 05:39 UTC. Commands, versions,
source commit, load, JSON, text and exit codes are retained. Text clocks use the
process timezone; the metadata timestamp is UTC.

`initial-config-error.txt`: first exploratory attempt, retained for transparency.
The probe used the invalid spelling `run-missing`; Squeal reported the config
problem and fell back to lookup-only. No test ran and the probe exited 1.
The script now uses the accepted value `lookup-then-run-missing`.
