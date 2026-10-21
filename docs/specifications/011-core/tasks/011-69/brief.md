# 011-69: a last-resort GC once the daemon is idle

Use /worker. Shape: slice. Outcome: a daemon that has run no tier for 60 s runs one full last-resort garbage collection, so V8 returns its freed pages to the system. On a cezar clone this took private memory from 791 to 486 MiB in a 154 to 234 ms pause, where a plain GC returned 0 to 7 MiB (`../../research/daemon-memory.md` 2, recommendation 2; the human chose this row on 2026-10-21).

Read: `research/daemon-memory.md` 1, 2 and 4; 011 C9; `src/core/daemon/lifecycle.ts` (the periodic check and `lastActive`) and `daemon.ts`.

The contract (the coordinator adds it to C9 at landing):

- **Idle** is no tier running in any lane for 60 s. Work queued and waiting for a slot or for load counts as idle: the 7 quiet daemons of 011-52 all waited on the slow lane.
- Then one `gc({ type: "major", execution: "sync", flavor: "last-resort" })`. No second one until a tier has run and ended since.
- The daemon gets `gc` itself, for example `v8.setFlagsFromString("--expose-gc")` and then `vm.runInNewContext("gc")`, or `--expose-gc` in its spawn. When `gc` is not available or throws, the daemon persists one note and keeps running without it. CI runs Node 22 and 24: say in your final message what `flavor` does on Node 22.
- One daemon log line per GC: private memory before and after, and the pause. No setting.

Seam: the check loop in `lifecycle.ts`, and a new `src/core/daemon/idle-gc.ts`. First edit, a lead: a pure decision over the clock, the last tier's end, whether a tier runs and whether a GC ran since, with its test.

Owns: `src/core/daemon/idle-gc.ts`, its wiring in `lifecycle.ts` and `daemon.ts`, their tests. Not yours: `src/runners/`, `src/core/scheduler/`, `src/core/status/`, `src/cli/` (011 wave 8), `src/core/ps/` (014).

Done when, tests first and red before:
- with an injected clock and `gc`: one call after 60 s with no tier; none while a tier runs; none twice without a tier between; one again after a new tier and 60 s; queued work waiting for a slot counts as idle; a missing `gc` gives one note and no crash;
- on Linux, a child process proves that the real last-resort GC lowers private memory after a large allocation is freed (skipped elsewhere);
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait` green, output pasted. A bundle change: the coordinator raises the version at integration.
