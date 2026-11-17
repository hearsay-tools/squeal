# Probes for row 005-104 (throwaway)

Throwaway probes of `../../consumer-view-design.md`. Kept as evidence; not maintained, not tests. Raw outputs stayed in the task's scratch directory.

Safety: `copy-tables.mjs` reads a live store from a read-only connection in one read transaction and writes only a new file in the task's scratch directory. `measure.mjs` refuses a path outside that directory and rolls back every timed write. No probe opens a socket, starts a daemon or runs hook code. `sim.ts` and `trigger-conflict.mjs` touch no store.

| Probe | What it does |
|---|---|
| `copy-tables.mjs` | Copies `meta`, `worktrees`, `revisions`, `checks`, `known_states`, `transitions`, `consumers` and `consumer_views` with their indexes and the write-marker triggers on `known_states` |
| `sim.ts` | Model check: the real `planDelta`, `restrictPlan` and `transitionKind` over random sequences of state writes, rewrites, retirements, registrations, deliveries and peeks; each design against today's copy. Run with `node_modules/.bin/tsx sim.ts <runs> <seed>` |
| `trigger-conflict.mjs` | In memory: whether an outer `INSERT OR REPLACE` changes a trigger's own insert (it does for `OR IGNORE`, not for the upsert form) |
| `measure.mjs` | On a copy: registration write, re-registration drop, delivery reads and state commits under the copy, the birth mark and copy-on-write; median and p90 of N runs with the 1-minute load average |
