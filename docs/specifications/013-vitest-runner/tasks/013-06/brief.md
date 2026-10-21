# 013-06: a closed Vitest instance is freed

Use /worker. Shape: slice. Outcome: after every awaited close of a Vitest instance, Squeal empties the closed instance, so a recreate or a slow-lane drain no longer keeps a whole instance alive. On cezar this cut what a close leaves from 110 to 114 MiB of heap to 7 to 15 MiB (`../../research/vitest-close-leak.md` 3 and recommendation 1).

Read: `research/vitest-close-leak.md` 1, 3 and its recommendation, and the probe `probes/vitest-close-leak/break-cezar.mjs` (its `noplugins` form); 013 V1 and V8; 004 D2.

The contract (the coordinator adds it to V1 at landing):

- After each awaited close (`#recreate` and a failed `#start` in `adapter.ts`, `closeBroken` in `broken.ts`, `closeRejected` in `startup.ts`, and the slow instance's close in `src/core/daemon/slow-instance.ts`), delete the own properties of the closed `Vitest`, its logger, its projects, its Vite servers (the root one and each project's) and their environments.
- Leave plugin objects alone: a config may import a ready-made plugin object that the next instance shares.
- Never in `abandon` (`run.ts`), whose close is not awaited and may hang.
- An error while emptying is caught and leaves the daemon running.

Seam: a new `src/runners/vitest/empty-closed.ts`. First edit, a lead: port `break-noplugins` from the probe into that module, with its test.

Owns: `empty-closed.ts`, its calls in `adapter.ts`, `broken.ts`, `startup.ts` and `slow-instance.ts`, their tests. Not yours: `run.ts`, `reporter.ts`, `src/core/scheduler/`, `src/core/status/`, `src/cli/`, `src/core/daemon/idle-gc.ts` (011-69).

Done when, tests first and red before:
- with Squeal's own dev Vitest, the adapter recreates its instance N times; after a forced GC, a `WeakRef` to each closed instance is empty except the last; the same for N slow-instance closes;
- a config that imports one plugin object runs green in the instance after a recreate;
- `abandon` is unchanged;
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait` green, output pasted. A bundle change: the coordinator raises the version at integration.

Starts only after 011 wave 8 W1 (011-54, 011-56, 013-03, in `src/runners/vitest/`) has landed, on a baseline that holds it.
