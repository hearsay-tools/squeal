# Probe: issue-17 (throwaway)

Throwaway. Not product code. Research for hearsay-tools/squeal#17, 2026-10-16. Findings: `../../issue-17.md`.

Every run used the shipped CLI on the probe host: `~/.local/bin/squeal`, which launched `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs` (the store's `worktrees.daemon_version` read `0.1.199`). Node 24.21.0, Vitest 5.0.5. The fixtures lived under the task scratch directory, never in a repository worktree. Each script sets `XDG_RUNTIME_DIR` to `<fixture>.run`, so the fixture's daemon socket, slow slot and capacity pool are its own: the host's slow slot was held by another worktree's daemon (`logs/host-slow-slot.txt`), which held a first attempt's slow files for minutes. No other worktree's daemon was stopped, restarted or written to; that worktree's status was only read.

## Files

- `make-fixture.sh <dir> <template> <delay ms>`: a git repository with `src/a.ts`, a fast `src/unit.test.ts`, three slow "browser" files `e2e/b{1,2,3}.e2e.ts` that wait `<delay ms>`, and a `squeal.config.json` shaped like cezarion's: `baseline.onStart: lookup-only`, `inputs: { "e2e/*.e2e.ts": ["src/**"] }` (cezarion declares `packages/web/src/**` for `packages/web/e2e/*.e2e.ts`), `slow` with `maxWorkers: 1, maxParallel: 1`, `runner: { tierSize: 4, timeoutMs: 600000 }`. `<template>` holds `package.json`, `package-lock.json` and `node_modules` with `vitest@5.0.5` (`npm install --ignore-scripts`).
- `named-wait.sh <dir> <template>`: question 2. Makes every file current, edits only `src/unit.test.ts`, then runs `squeal status --json --wait 30000 src/unit.test.ts`, the runs since the edit, `squeal status --wait 120000 src/unit.test.ts`, and the selection for `src/a.ts` as a control.
- `discovery.sh <dir> <template> fast|slow plain|touch|config`: question 3. Adds a fast-lane file `long/long.test.ts` (duration from `long/delay.ts`), makes every file current, starts a long run (fast: lengthens `long/long.test.ts` so its edit queues it; slow: lengthens the browser files and asks `run --slow`), then during that run: `touch` rewrites `src/a.ts` with its own bytes, `config` appends a comment to `vitest.config.ts`, `plain` does neither; then it edits `src/unit.test.ts` and creates `src/new.test.ts` and polls. Environment: `LONG_MS` (default 60000), `TIMEOUT_MS` (`runner.timeoutMs`, default 600000), `MAX_POLL_MS` (default 240000), `RESTART=1` (stop and start the fixture daemon when the new file is still unlisted after polling).
- `poll.mjs`: one line every 2 s from `squeal status --json` and the store: revision, refined revision, `runnerPartPending`, checks queued and running, test files without checks, slow activity, whether the store lists the new file, and the runs still open.
- `store-query.mjs <store> <sql>`: read-only `node:sqlite`.
- `logs/`: the output quoted in the findings. `named-wait-run1-outputs-in-fixture.txt` is a first run whose output files were written inside the fixture and made revisions 2 and 3; `named-wait.txt` is the clean run. The four 60 s `discovery-*.txt` logs predate the `LONG_MS`/`TIMEOUT_MS`/`RESTART` options and the step 6 notes; their runs match the defaults.

## Replay

```sh
S=<scratch dir>; P=<this dir>
mkdir -p $S/tpl && cd $S/tpl && printf '{"name":"t","private":true,"type":"module","devDependencies":{"vitest":"5.0.5"}}\n' > package.json && npm install --ignore-scripts
$P/named-wait.sh $S/nw $S/tpl
$P/discovery.sh $S/dfp $S/tpl fast plain
$P/discovery.sh $S/dft $S/tpl fast touch
$P/discovery.sh $S/dfc $S/tpl fast config
$P/discovery.sh $S/dst $S/tpl slow touch
LONG_MS=600000 TIMEOUT_MS=30000 MAX_POLL_MS=200000 RESTART=1 $P/discovery.sh $S/dhc $S/tpl fast config
```

Each takes 2 to 8 minutes. Timings were taken at host load 15 to 25.
