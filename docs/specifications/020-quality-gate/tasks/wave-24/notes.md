# Wave 24 notes: rows 020-62 and 020-66 (worker 8515db3f, 2026-11-14)

## 020-62: `ci-record.test.ts` "exits with the command's code"

**Cause found.** A test race in the fixture, not a product fault. The crashing fixture was
`it("leaks", () => { setTimeout(() => { throw … }, 0); })`. The test ends synchronously, and the
throwing timer can still be pending when Vitest ends the worker. Then no error is seen and the
bare `vitest run` exits 0. `ci record` passed that 0 on, so both `expect(crash.exit).toBe(plain(…))`
and `expect(crash.exit).not.toBe(0)` saw the race. `ci record` did not drop a real error: the plain
run (no Squeal) exited 0 as well.

Probe (Node 26.13.0, host load average 1.5, bare `vitest run` of the fixture alone, 20 runs each,
scratch copy outside the repo):

| fixture | exit 0 |
| --- | --- |
| old: `setTimeout(throw, 0)`, test ends at once | 2 of 20 |
| new: same timer, then the test awaits `setTimeout(r, 20)` | 0 of 20 |

**Fix (test only).** The fixture test now awaits a later timer (20 ms) after it schedules the
throwing one. Node fires timers in delay order, so the throw happens before the test ends, every
run. The error is still uncaught and outside any test assertion, so the case still covers
"an error outside every test file". The exit-code assertions are unchanged.

**Done-when → tests.**
- "passes 20 times in a row on Node 26 and keeps its exit-code assertion":
  `pnpm exec vitest run test/cli/ci-record.test.ts -t "exits with the command"`, 20 runs in
  sequence on Node v26.13.0: **20/20 passed**. The assertions `crash.exit === plain(crashing)` and
  `crash.exit !== 0` are kept as they were.

## 020-66: `EarlyWrites` starts no pass after `stop`

**Cause found.** In `#loop`, `await this.#paused(pause)` resolves `true` when the pause's `then`
runs; the loop resumes one microtask later. A `stop()` call in that gap set `#stopped`, but
`#cancel` was already `null`, and the loop did not check `#stopped` again before the next
`#pass()`. So one more pass started with `stopped` set.

**Fix (product, approved by the parent, request c6c13542).** `keep-queue.ts`: after the pause
resolves, the loop also returns when `#stopped` is set. One line; no other behaviour changes.

**Done-when → tests.** `test/code/gate/keep-early-stop.test.ts` (new):
- "starts no pass when stop follows the release in the same turn": drives the order through the
  `Pause` seam (`end()` then `stop()` in the same turn). **Failed before the fix** (2 passes, commit
  32ef389ee alone), **passes after** (commit bb84f2288).
- "still starts the next pass when the release comes with no stop": guards that the fix did not
  stop the normal retry after a pause.

## Checks run

- `pnpm run lint`: pass (biome, 3471 files, no fixes).
- `pnpm run typecheck`: pass.
- `pnpm exec vitest run test/code/gate/keep-early-stop.test.ts`: 1 failed / 1 passed before the
  fix; 2 passed after.
- ci-record 20-run loop: 20/20 (above).
- `squeal status --wait 60000` on the three changed paths (revision 5, last read 19:52 local):
  356 current, **355 pass**, and 5 pending. Four bundle-drift tests fail
  (`test/harness/plugin.test.ts`, `test/harness/{codex/packaging/runtime,opencode/package,pi/package}.test.ts`:
  `cli/squeal.mjs differs from the build`). This is expected: `keep-queue.ts` is bundled, and the
  brief forbids `pnpm run build` in a worker tree. The coordinator rebuilds the bundles at
  integration. Two of the pending files (`test/cli/code-gate-keep.test.ts`,
  `test/daemon/drain-wait.test.ts`) were still running in Squeal after several waits, so they were
  run directly:
- `pnpm exec vitest run test/cli/code-gate-keep.test.ts test/daemon/drain-wait.test.ts test/code/gate/`:
  71 files, 443 tests, all pass (180 s).

## Checks not run

- `pnpm run build` and bundle refresh (brief: no build in a worker tree).
- No full suite (brief and `docs/process.md`).
- The ci-record loop on Node 22 (only Node 26 is on this host's path; CI saw the race on both).
