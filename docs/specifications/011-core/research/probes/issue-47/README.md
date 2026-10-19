# Issue 47 probe (throwaway)

Throwaway evidence for `../../issue-47.md`; delete freely. Not product code, not a test.

`probe.sh <old plugin root> <new plugin root> <vitest node_modules> [hold-s] [wait-s] [release|stopstart]`
refuses to run when the one-minute load is at or above the CPU count. It writes a four-file Vitest repo
under a fresh `/tmp/issue47.XXXX`, with `HOME` and `XDG_*` inside it, so no real daemon, socket or
store is reached. The old CLI's `squeal start` runs a clean baseline. Then the probe turns on a hold flag
outside the repo and edits `tests/hold.test.ts` (which loops while the flag exists) and `tests/a.test.ts`.
That leaves the old daemon with an edit's Vitest tier in flight. Six new-plugin `session-start.mjs`
hooks follow, three concurrent and three one second apart, under distinct session ids, and the probe
prints processes, `start`, `status --json` and a 3 s named wait. After `wait-s` it either releases
the hold (`release`) or runs the new CLI's `stop` then `start` with the hold still on (`stopstart`,
the reporter's recovery). `BASELINE=lookup-only` sets `baseline.onStart` as the reporter's cezarion
config does. Every fixture process is killed by its `/tmp/issue47.*` path at the end; the probe roots
were removed after the runs.

Runs kept (plugins from `~/.claude/plugins/cache/hearsay/squeal/<version>`, Vitest 4.1.10 from
`/home/agent/projects/cezar/node_modules`, Node v24.21.0):

- `output-run1.txt`: 0.1.223 → 0.1.224, hold released after 5 s; one successor takes over.
- `output-run2-wait135.txt`: same, hold held 135 s; six successors give up at 120 s, `start` says alive beside a down snapshot.
- `output-run3-stopstart.txt`: same, stop/start after 30 s, default baseline; the edit is re-run.
- `output-run4-lookup-only-stopstart.txt`: as run 3 with `BASELINE=lookup-only`; every check stale, nothing queued, wait returns on quiet.
- `output-run5-control-same-version.txt`: 0.1.224 → 0.1.224, `BASELINE=lookup-only`, stop/start; no step-down, the held file still ends stale and unqueued.
