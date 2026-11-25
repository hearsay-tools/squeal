# Issue 281 throwaway probe

This is a synthetic source-level diagnostic probe, not an upgrade reproduction.
It extracts the unchanged production functions from named Git revisions, strips
TypeScript using Node, and runs them in a VM with a virtual clock and stubbed
daemon I/O. It starts no daemon, creates no store or socket, kills nothing and
installs nothing. No live host isolation or boat sandbox is needed for this probe.

From the repository root, with Node 26:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-281/probe.mjs > docs/specifications/011-core/research/probes/issue-281/results.jsonl
```

Optional arguments replace the four default Git refs. The load gate refuses a
run when the one-minute load exceeds the host's CPU count. The results record
each peeled commit SHA. The recorded run exited 0 in under one second. Its
90,050 ms figures are **virtual**, not measured elapsed startup times.

The handover cases inject a claim, no answering successor and a free lock:
`ensureDaemon` either reports `unavailable`, or reports `spawned` followed by
absence (consistent with immediate exit, whose event this caller cannot read).
The ordinary-start control supplies an already-ended child's observer.
The presence cases inject a marked shutdown, expired heartbeat and no start mark,
varying only whether the lock is free. Real process death, socket ownership,
upgrade scripts, runtime deletion, SQLite and hooks are outside this experiment.

Assertions cover exit status, virtual wait, spawn attempts, the diagnostic and
the stopping/absent presence distinction. `results.jsonl` is the saved output.
