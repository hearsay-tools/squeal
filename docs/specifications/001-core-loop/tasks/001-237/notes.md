# 001-237 and 001-242 notes: two CI timing tests hold

Both causes come from the CI logs of 2026-10-10 (`gh run view <id> --log`), and both were reproduced here beside one busy loop per core.

## 001-237 `test/runners/node-test/graph-cost.test.ts`

**Cause: a tight ratio measured with unpaired minima.** The old comment says a re-resolve is "about a tenth" of the cold build. In fact it is the cold build minus the parse. Resolution, run again from empty caches after `resolver.clear()` (D4), is most of the cost. Over 66 CI jobs (33 runs, Node 22 and 24), min(re-resolve) / min(cold) ranged from 0.60 to 1.19 and was mostly about 0.8. Three were 1.00 or more: 1.00, 1.04 (`58378c7b`, 84.66 against 82.21 ms) and 1.19. Locally the paired ratio is 0.76 to 0.80. Five unpaired samples per side leave the minimum exposed: when the host's noise lands on all five re-resolves and not on one cold build, the comparison flips. It was a fixed claim against a 20 % margin, not a slow step.

**Fix, keeping both claims (spec 003 goal 6, test (f)):**

- The work is counted, which no load moves. `vi.mock` wraps `parseModule` (`graph/parse.js`) and each resolver's `resolve` (`graph/resolver.js`, through `createResolver`), and counts calls. Per round: the cold build parses every reached module (882), a re-resolve parses none (D4: from cached parses) and looks up no more specifiers than the cold build (2,893), and an edit parses one module and looks up under 5 % of the cold build's specifiers.
- The time is compared per round. Each re-resolve and each edit is divided by the cold build measured just before it, and the median of 9 such ratios is asserted: re-resolve < 1, edit < 0.05. The bounds are the spec's own and none was raised. A warm-up build stays first. A preempted sample, or a load that drifts between rounds, moves one ratio and not the median.

Measured here with no load: re-resolve 0.76 of cold, edit 0.0017. Beside 24 busy loops (the probe, 15 rounds): paired median 0.79 to 0.80, with single ratios up to 1.89, which is exactly what the median absorbs.

## 001-242 `test/integration/node-test.test.ts`

**Cause: a race in the wait, not a timeout or a slow step.** CI at `42b1aee9` (run 38071969298, Node 24) failed at line 274 after 10.45 s, under the test's 300 s budget: `expected [ 'packages/a/test/one.test.ts' ] to deeply equal [ ..., ... ]`. After the edit of `one.ts`, `settle` accepted on `knownFailures.length === 1` with nothing pending. Task 001-171 re-runs a new FAIL once, forced, and a forced re-run keeps the result current while it waits (D5). So status reads quiet before the re-run's run row is stored, and a fast poll saw one run of the two. The third baseline in the same test already waited for its re-runs (`ranFiles(...).length >= 6`). The original test reproduced this here 1 time in 6 beside 24 busy loops (load about 60 to 80), with the same assertion.

**Fix:** that `settle` also waits for `ranSince(main, main, from).length >= 2`. The exact `toEqual` of the two runs that follows is unchanged, so a third run still fails the test.

## Not changed

- `test/e2e/support.ts` `until` and the poll interval: shared helpers that neither row owns, and not part of either cause.
- `test/cli/status-wait-edit.test.ts` failed once on CI (run 38085637578, `expected 499.934 to be greater than or equal to 500`). That is a timer-resolution edge in a different test, outside this row. It may want a row of its own.
