# lanes-survey probes (throwaway)

Throwaway scripts for row 019-08, open question 7 of spec 019: the memory and
start time of one more Vitest instance in one process. Not product code; do not
import them. Results are in `../../lanes-survey.md` section 3.

- `make-fixture.mjs <dir> <modules> <tests>`: writes a fixture repository
  (ESM, `vitest.config.mjs`, `src/m<i>.mjs` modules in a chain of imports,
  `test/t<i>.test.mjs` files that each import a slice of them).
- `instances.mjs <fixture> <count> <workers> [filter] [limit]`: in one Node process, as the
  daemon does (`createVitest('test', { watch: false })`, then `standalone()`),
  creates `count` instances one after another; for each it prints the start
  time, the first run of every test file, a second run, and the process's RSS
  and heap after each step, plus the RSS of the worker processes during and
  after the run (read from `/proc`). Linux only.

- `cycles.mjs <fixture> <cycles> <workers> [filter] [limit]`: creates, runs and closes one
  instance `cycles` times, printing the heap after each close.

Run with the fixture's `node_modules` a symlink to this repository's (Vitest
5.0.3); call `node` directly, never `pnpm exec` (a symlinked copy reinstalls
through it).
