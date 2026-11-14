# Issue 214 probes (throwaway)

Run from the repository root, using its installed dependencies:

```sh
pnpm exec tsx research/probes/issue-214/probe.ts > research/probes/issue-214/output.txt 2>&1
```

This is a research fixture, not a product regression test. It refuses to run
when one-minute host load exceeds available CPUs. It creates and removes its
own temporary git repository and stores. It starts no daemon, generates no
host load, installs nothing and runs no repository test suite. Do not commit
`node_modules` here. The saved output's temporary run-log path no longer exists.

The first part calls the real retry intake, persistent retry records and
`RunQueue`. A small Ledger stand-in only supplies file lookup and queue
insertion. The clock jumps; the supplied load of 170 on 24 CPUs is synthetic.
There is no runner or capacity pool in this part. It proves eligibility and
queue ordering, not scheduler progress or the incident's 40-minute stall.

The second part calls the real `codeGateCommand` handler with one real
node:test file. The assertion fails deliberately. The first gate runs it and
keeps its failure and coverage. The probe asks a load retry directly through
`askRetry` at the gate's computed key. The second gate reuses that failure.
It adds an environment request and checks reuse again. No daemon is present,
so these requests deliberately remain pending. The gate load seam returns
zero for the first run and 170 for the subsequent lookups; host load is not
changed. This proves reuse while a request is pending, not a load-induced
failure or a failure to make progress in a live daemon.

Finally the real retry command parser rejects `--wait`. The probe does not
test completion of a live `status --wait` or a daemon restart.

Examined: Squeal 0.1.477 at `b12273f596f01c4d82535860dbafcd9bc43b6476`,
Node v26.13.0, pnpm 12.15.0. See the findings file for sources and limits.
