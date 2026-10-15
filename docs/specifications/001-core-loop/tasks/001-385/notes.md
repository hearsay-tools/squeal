# 001-385 notes: the daemon suite's build hooks under load

## Cause

Since 001-360 a suite-level hook error fails its whole file. `daemonSuite` (`test/daemon/helpers.ts`) registered `beforeAll(() => built = buildCli(options))` and `afterAll(() => built?.cleanup())` with no timeout, so both ran at Vitest's 10 s `hookTimeout` default. Both bodies are synchronous: `tsc -p tsconfig.build.json` over `src` (`execFileSync`), and `rmSync` of its output. Vitest 5 still fails a synchronous hook that returns past its deadline (`withTimeout` checks `deadline.exceeded()` on resolve, vitest issue 2920), so blocking the thread is no escape. Both hooks have failed loaded gates: the `afterAll` in `handover.test.ts` and `shared-store.test.ts` at load 80 to 110 (the 0.1.178 candidate), the `beforeAll` in `departure.test.ts` (`reviews/wave-13ay.md`). The `afterEach` already had `SLOW.timeout` from 001-320.

## Fix

- `suiteCli(options, build = buildCli)` in `test/daemon/helpers.ts` registers the build and its removal, both with `SLOW.timeout` (180 s, the file's daemon tests' own bound), and returns a getter for the build. `daemonSuite` uses it.
- The five files that built the CLI by hand with the same two default-timeout hooks now call `suiteCli()`: `scratch.test.ts`, `scratch-children.test.ts`, `scratch-identity.test.ts`, `scratch-refused.test.ts`, `socket-handover.test.ts`. Their top-level `afterEach` stops daemons with `stopProcess` (SIGKILL only after 60 s), the 001-320 shape at the 10 s default; it gets `SLOW.timeout` too.
- The waits themselves are unchanged.

## The test

`test/daemon/suite-hooks.test.ts` sets `vi.setConfig({ hookTimeout: 100 })` before `daemonSuite` registers its hooks, with an injected build whose build and cleanup each block the thread for 300 ms. Checked red: with the `afterAll` back at the default the file fails "Hook timed out in 100ms" with its test passed; with the `beforeAll` at the default it fails with its test skipped. Green with both bounded, in about 0.6 s.

## Left at the default

The other top-level `afterEach` hooks in `test/daemon/` (`desk-guard`, `nudge`, `run-all-owner`, `run-all-warm-up`, `run-slow`, `server-handover`, `socket`, `sync`) only remove directories and close in-process servers or desks; none waits on a child process. `symlinked-source.test.ts`'s `afterAll` removes two plugin bundle directories, the same shape as the build's removal; it was not seen failing, and gets its `beforeAll`'s 120 s bound anyway. Hooks outside `test/daemon/` were not surveyed.
