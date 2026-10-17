# Probe: issue 20 (throwaway)

Throwaway evidence for `../../issue-20-reproduction.md`. Not product code; nothing imports it.

- `run.sh [rounds]`: builds `/tmp/i20-XXXXXX` with its own `HOME` and `XDG_RUNTIME_DIR`, copies the installed Squeal plugin (0.1.199; `SQUEAL_PLUGIN=<dir>` for another), makes a git repository from `fixture/` with two worktrees, installs Vitest 4.1.10 there, runs one unforced checkpoint (phase A) then `rounds` forced checkpoints (phase B), prints status, failures and `why` for each file, starts the second worktree, stops both daemons, and runs the race file under plain Vitest as the control. Refuses to run when the one-minute load is not below `nproc`. Needs network for `npm install`. The scratch directory is kept for inspection; delete it after.
- `store-scan.mjs <store.sqlite>...`: read-only scan (`node:sqlite`, `readOnly: true`) of a Squeal store for failure texts and transitions naming a temp path or ENOTEMPTY/EBUSY/EEXIST.
- `fixture/test/race.test.ts`: `afterAll` removes its own mkdtemp directory while a child it started is still flushing into it (the issue's shape). `setup-race.test.ts`: the same race in `beforeAll`. `stuck.test.ts`: a deterministic defect, a non-recursive `rmdirSync` on a directory the test filled; same error code, same kind of path.
- `observed-run.txt` (12 rounds, load 16.8 on 24 CPUs), `observed-run-2.txt` (an earlier 12-round set, before phase A and the control were added), `observed-stores.txt` (stores as of 2026-10-17T08:16Z): the outputs the findings quote.
