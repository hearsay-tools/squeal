# 011-235: a full check gives its claim back on one rule

Wave 49 W3, slice. Baseline `89f458320`. Changed files: `src/core/daemon/full-check.ts` and `test/daemon/full-check.test.ts`.

## Cause

`FullCheckOwner` gave the day's claim back on two paths: the unrun branch in `#start`, and `stop()`, which called `#giveBack()` after `await this.#run`. A start that threw after it took the claim (for example `run` throwing `spawn E2BIG`) went to the constructor's `catch`, which only logged. So the claim stayed until the daemon stopped. While that daemon served, no other daemon on the store ran the full check. A daemon killed without a stop kept the claim for 24 h. Row 011-229's notes found this.

## The change

- `#start` gives the claim back in one `finally` around the check, unless the check answered (passed, or a fault marked). A throw, an unrun check, a stop during the check and a stop that comes once the claim is taken all go through it.
- `stop()` only sets `#stopped`, stops the check and awaits `#run`. The run's `finally` gives the claim back, so `stop()` still resolves once the claim is given back or after `RELEASE_WITHIN_MS`.
- `#giveBack(claim)` has one caller, the `finally`. It no longer keeps a shared promise (`#release`), because nothing else waits for it. The fields `#claim`, `#answered` and `#release` are gone; `answered` is a local of `#start`.
- `RELEASE_WITHIN_MS` is now `DAEMON_START_BUSY_TIMEOUT_MS`, imported from `./open.js`. `open.ts` does not import `full-check.ts`, so there is no import cycle. `grep 120_000 src/core/daemon/full-check.ts` finds nothing.
- The log lines are unchanged. On a throw, the give-back runs before the constructor's `catch` logs `full integrity check failed: …`. So when that line is logged, the claim is already given back.

No type changed. `RELEASE_WITHIN_MS` keeps its name, export and value (120 000 ms).

## Tests

`test/daemon/full-check.test.ts`:

- 011-229's throwing-start case now expects the claim back at once, before the stop. Then another connection on the store (another daemon) starts at `T + 1`, claims and runs its check, while the first still serves. The first one's stop leaves that claim in place. Its log expectation is unchanged.
- New: "is given back by a stop that comes once it is taken, before a check runs". A stop called in the same tick as the start comes after the start's first synchronous try took the claim. No check runs, the claim is given back, nothing is logged. This covers the `if (this.#stopped) return` path inside the `try`, which `stop()` covered before.

`full-check-busy.test.ts` and `full-check-daemon.test.ts` are unchanged and pass.

## Evidence

- Before the fix, Squeal at revision 1: the changed throwing-start case failed with `expected '1800000000000' to be null` at the new claim check before the stop.
- Mutant: the give-back moved out of `finally` to after the `try`. `npx vitest run test/daemon/full-check.test.ts`: 2 failed, 10 passed. The two new expectations failed, each with `expected '1800000000000' to be null`. Restored with `git checkout`.
- With the fix: `npm run lint` clean (biome, 2223 files). `npm run typecheck` clean. `squeal status --wait 60000` on the changed paths and the three full-check test files: the three full-check files pass, current at revision 4.

## For whoever continues

- `full-check.ts` is imported only by `src/core/daemon/daemon.ts`. Squeal selects about 205 test files for it through `daemon.ts`'s readers; most of them run in the quiet catch-up, not in the edit tier.
- The give-back still waits at most `RELEASE_WITHIN_MS` for a busy store and then leaves the claim, logged. A daemon killed while the store stays busy, or killed before its `finally` runs, still keeps the claim for 24 h. That is outside this row.

## Commits

- `9fa065002` fix(011-235): give the full check's claim back in one finally unless it answered
