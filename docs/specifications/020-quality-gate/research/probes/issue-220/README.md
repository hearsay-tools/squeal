# Issue 220 probes (throwaway)

Research evidence for `../../issue-220.md`, not product tests. Delete them
when the spec rows that use them land.

`bound.probe.ts` is deterministic: a fake clock and a fake writer drive the
real `keepFile`, `sliced` and `StoreWait` (`src/core/code/gate/keep-write.ts`)
as the keeper's last pass drives them. No store, daemon, runner or real HOME
is touched, so it may run at any host load. It sleeps only the real
`busyBackoffMs` pauses (0 ms after a file's first refusal).

```sh
node_modules/.bin/vitest run \
  --config docs/specifications/020-quality-gate/research/probes/issue-220/vitest.config.ts
```

`evidence-2026-11-14.txt` is the saved output of the run cited in the report.

`holder.mjs` and `starve.mjs` are a timing probe on a scratch SQLite file
under `$TMPDIR` (no Squeal store). `holder.mjs` runs write transactions
back to back, each held `holdMs` by `Atomics.wait` (a sleep, no CPU work),
with `gapMs` between COMMIT and the next BEGIN. `starve.mjs` is a waiter
with the keeper's slice (20 ms or 250 ms busy timeout) and `busyBackoffMs`
pauses, and 20 ms between landed writes. Each case runs 8 s. Run it only
while the one-minute load is at most the CPU count; it records the load.

```sh
node docs/specifications/020-quality-gate/research/probes/issue-220/starve.mjs
```

The first attempt (not in the evidence file) had no pause after a landed
write and no retry in the holder: the waiter starved the holder, which
exited on its own busy timeout. Those numbers are void.
