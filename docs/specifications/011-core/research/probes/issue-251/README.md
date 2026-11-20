# Issue 251 probe

Throwaway research fixture. It imports real retry code and supplies an in-memory
store, one file, a minimal ledger, fake time, fake load and a failing result.
It starts no daemon or test runner, creates no host overload and waits no 10 minutes.
It does not exercise SQLite, CPU admission, actual test timing, CLI rendering,
known-state updates or harness session discovery. No dependencies are added.

From the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-251/probe.mts
```

To probe the reported release's source without checking it out or changing product files:

```sh
probe_root=$(mktemp -d /tmp/squeal-issue-251-XXXXXX)
trap 'rm -rf "$probe_root"' EXIT
git archive squeal--v0.1.570 src package.json | tar -x -C "$probe_root"
pnpm exec tsx docs/specifications/011-core/research/probes/issue-251/probe.mts "$probe_root"
```

Both commands exited 0 on 2026-11-20 with identical output (Node v26.13.0,
pnpm 12.15.0). The assertion-bearing probe, not Vitest or a full suite, ran:

```json
{"phase":"cap","elapsedMs":600000,"oneMinute":69.6,"cpus":24,"queued":1,"note":"load retry of test/synthetic-timeout.test.ts queued under load 2.90 per CPU, at or above one per CPU, once it had waited 10 min for the one-minute load average to fall below the CPU count (spec 011 C5)"}
{"phase":"calm","oneMinute":12,"cpus":24,"loadAgain":"spent","environmentAgain":"spent","queued":1,"recordedRunLoad":2.9}
{"phase":"controls","restoredStoreSameSession":"spent","laterSession":"queued","changedKey":"queued","verdict":"synthetic mechanism reproduced"}
```

The restored-store control reuses the in-memory meta rows through another store
wrapper. It verifies record-based accounting, not a real daemon restart or durable
SQLite recovery. Later-session and changed-key controls test budget scope, not
recommended ways to evade a failure.
