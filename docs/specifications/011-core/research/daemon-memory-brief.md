# Research brief 011-53: give a quiet daemon's memory back

Use /researcher. Shape: research. Outcome: how much memory a quiet daemon gives back after a forced garbage collection, and after it closes its Vitest instance; and what each costs the next edit. Measured on a cezar-size worktree, so the next row can choose a policy from numbers.

## Why

011-52 (`daemon-scope.md`) found that a cezar daemon holds 450 to 1,800 MiB, nearly all of it per-worktree Vitest work, and that daemons rose and fell by up to 980 MiB in 20 minutes. It did not measure the live set. Today the daemon keeps its Vitest instance open for its whole life: `src/runners/vitest/adapter.ts` closes it only at `close()` or on a config change (`#recreate`). Nothing in `src/` calls a GC, sets a heap limit or reads memory. The human (2026-10-21) asks whether garbage collection can replace stop rules, and why a quiet daemon should hold 2 GB.

## Read first

`daemon-scope.md` 1 and 3, and its probes; `../../014-ps/research/process-measurement.md` 2 (how to read private memory, the 256 KiB heap mappings, mimalloc); `src/runners/vitest/adapter.ts` (`#start`, `#recreate`, `close`), `src/core/daemon/slow-instance.ts`, `src/core/daemon/runner.ts`; 011 C9 and C10.

## Questions

1. **A quiet daemon on its own.** In a daemon you started on a cezar clone: private memory, swap, `process.memoryUsage()` and `v8.getHeapStatistics()` after the baseline, after each of three edit tiers, and then at 1, 5, 15 and 30 minutes of quiet. Does V8 give memory back by itself?
2. **A forced full GC.** Run one after a tier and once when quiet. How much heap and private memory does it free, how long does the pause take, and how much of the memory goes back to the system? The heap used after a full GC is the live set. Check native memory too: mimalloc (Rolldown) and the glibc heap.
3. **Closing the Vitest instance when quiet.** Memory after `vitest.close()` and a GC, against the daemon without Vitest (88 to 101 MiB). Then the cost of reopening it: the time from the next edit to its result with a cold instance, against a warm one, over at least three repetitions each.
4. **Policy and saving.** When to run the GC (after each tier, after N seconds of quiet), what N for a close, and whether a heap cap is still needed. Give the expected saving on the 2026-10-21 population (19 daemons, 14.7 GiB private, `daemon-scope.md` 3).

A lead, not a rule: start your daemon with `NODE_OPTIONS='--expose-gc --import <your probe>'`, so that a probe module inside the daemon logs memory and runs a GC on a signal, with no product change. For question 3, a script that calls `createVitest` with the adapter's options may be simpler than a patched daemon.

## Rules

- The live host is read-only evidence. Never connect to a live daemon's socket, open a live store for writing, or signal or renice a process.
- Work on a clone of cezar under `/tmp` (`git clone`, never `git worktree add`: a worktree of the live repository shares its live store). Install its dependencies offline from the host's pnpm store. Never write to `/home/agent/projects/cezar`.
- Your daemon runs with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp`, uses the installed Squeal bundle, runs at most 4 test workers and keeps the slow lane off. No build in your worktree.
- Do the source and documentation reading first. Run a live measurement only while the one-minute load is below 24 (the CPU count), and record the load beside every number. If the load does not fall below 24 within 90 minutes of your first measurement attempt, commit what you have, and name the measurements still open.
- At the end, stop your daemon, remove the clone and show that nothing of it is left.
- Tag every finding: `verified by experiment`, `read in source code`, `read in official docs` or `inferred`. Budget about two hours.

Own `daemon-memory.md` and `probes/daemon-memory/` only. Edit no board, spec, status, test or product file.

Done when every numbered question has a tagged answer or "not determined, because", and the recommendation gives the GC and close policy with its saving in GiB and its cost in seconds for the next edit. Commit.
