# 011-388 notes: the named wait's elapsed tenth checked between measured ends

## Change

`test/cli/status-wait-pool.test.ts`: the helper `timedOut` returned the named
wait's text, which holds "the deadline passed after 0.1 s". The case at `:141`
(now about `:160`) compares five texts with `toEqual`, so a run whose wait
took another tenth under load failed. `timedOut` now:

- measures its own `waitForNamed` call (`performance.now()` before and after);
- checks `waitedMs` against two ends (below);
- checks the text has the shape `the deadline passed after \d+\.\d s` and
  prints that `waitedMs` to one decimal;
- returns the text with that elapsed part replaced by `after N s`, so the
  `toEqual` and `toContain` checks compare everything else exactly.

Product text is unchanged. Every case in the file goes through `timedOut`
except the `--json` case, which holds no elapsed text.

## The bound and why it is not host-tuned

Same method as row 011-374 (`tasks/011-374/notes.md`):

- Lower end: the asked wait (60 ms) less 1 ms. The outcome is a timeout, so
  the deadline passed; a timer can fire up to 1 ms early on
  `performance.now()` (`test/cli/wait-clock.ts`).
- Upper end: the call's own measured duration plus 1 ms (`waitedMs` is
  rounded).

No constant depends on this host's speed or load: a slower machine moves the
printed time and the measured upper end together.

## Checks

- `pnpm exec vitest run test/cli/status-wait-pool.test.ts`: 3 of 3 runs,
  4 of 4 tests each, at load average 24 to 28 on 24 vCPUs, 2026-11-16.
- `pnpm run lint`: clean. `pnpm run typecheck`: clean.
- `squeal status --wait 60000 test/cli/status-wait-pool.test.ts`: no known
  failures, current result at revision 1.
