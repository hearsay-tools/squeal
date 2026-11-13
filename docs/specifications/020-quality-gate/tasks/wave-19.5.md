# Wave 19.5: repair of `cand/0.1.468` (review `reviews/0.1.468.md`: FAIL)

Base: worker 926f04b4's own branch (`cez/926f04b4`); the coordinator cherry-picks the repair onto the candidate (`w19/land`, which also holds row 020-53). Same check rules as `tasks/wave-19.md`.

## R1 (row 020-54, B1)

Use /worker. Shape: repair. Read `reviews/0.1.468.md` B1 and candidate CI 43482303375.
- Gate tests that are not about the load rerun do not pin the host load, so on a small CI runner (load at or over its CPU count) the rerun fires and changes what they see. CI failed `test/cli/code-gate-failed-outside.test.ts:65` (row 020-53's: B read from the run, not the stores), `test/code/gate/collect-prepare.test.ts:194` (two adapter calls, not one) and `test/cli/code-gate-log.test.ts` (the kept-log line). The product behaviour is right; the tests are not isolated from the host.
- Give every gate test a way to pin the load (the `CollectOptions.hostLoad` seam, and the same for the CLI's `gate` entry, by an injected io field or a test-only option, never an environment variable users could set by accident). Pin the load below the threshold in every gate test that has a failing file and is not about the rerun; find them all, not only the three CI named. Keep the rerun tests and their no-storage contract.
Owns: `src/core/code/gate/{collect,retry}.ts`, `src/cli/code-gate.ts` (the seam only), and any test under `test/code/gate/` or `test/cli/code-gate*.test.ts` that needs the pin, including row 020-53's `code-gate-failed-outside.test.ts`.
Done when (tests): the three CI failures pass with the host load forced at and over the CPU count (simulate it through the seam in a test, not with real load), and every rerun test still passes; a test proves a non-rerun gate test's result does not depend on the host load.
