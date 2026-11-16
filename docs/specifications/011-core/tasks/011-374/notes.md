# 011-374 notes: elapsed text checked between measured ends

## Change

`test/cli/status-wait-paused.test.ts` expected "after 0.6 s" exactly in two
cases (the named wait's "the deadline passed after 0.6 s" has the same
exposure as the row's "Returned on timeout after 0.6 s"). Both now check the
line's shape with `\d+\.\d s`, and `expectElapsed` checks N against two ends.

`test/cli/status-wait-edit.test.ts`, the environment-edit timeout case,
expected `after 0\.\d s` for an 800 ms wait: it failed once the wait reached
950 ms. It now checks `waitedMs` against two ends and that the line prints
that `waitedMs` to one decimal. The quiet case already used `\d+\.\d s`.

Product text is unchanged.

## The bound and why it is not host-tuned

- Lower end: the asked wait (600 ms, 800 ms) less 1 ms. The outcome is a
  timeout, so the deadline passed; a timer can fire up to 1 ms early on
  `performance.now()` (`test/cli/wait-clock.ts`, task 001-334). The paused
  case also allows 50 ms, the half tenth `toFixed(1)` rounds.
- Upper end: a time the test measures on the same run, never a constant. In
  the CLI case, spawn to the first output byte (`Run.beforeMs`) plus the half
  tenth; in-process, the `waitForStatus` call's own duration plus 1 ms (the
  result rounds `waitedMs`).

No number depends on this host's speed or load: a slower machine moves both
the printed time and the measured upper end together.

## Checks

3 of 3 passes of both files (10 tests) at load average about 15 on 24 vCPUs,
2026-11-16.
