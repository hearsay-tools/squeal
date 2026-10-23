{"readCoverageMs":7.5,"countAndJoinMs":202.8,"joinOnlyMs":11.4,"matched":384,"unmatchedTs":1,"ambiguous":0,"unmatchedCoverage":1}
unmatched coverage functions: [ 'src/core/delivery/expiry.ts:155 (anonymous_7)' ]
crapStmt { n: 384, p50: 2, p90: 8.2, p99: 39, max: 90, atLeast30: 10 }
crapMin { n: 384, p50: 2, p90: 9, p99: 42, max: 90, atLeast30: 12 }
crapLine { n: 384, p50: 2, p90: 8.3, p99: 40.8, max: 90, atLeast30: 10 }

| CRAP (stmt) | CRAP (min stmt, branch) | CC | stmt % | branch % | calls | function |
| --- | --- | --- | --- | --- | --- | --- |
| 90.0 | 90.0 | 9 | 0 | 0 | 0 | `src/core/delivery/attribution.ts:252` withFlaky.<anonymous#2> |
| 42.0 | 42.0 | 6 | 0 | 0 | 0 | `src/core/delivery/uncovered.ts:37` tellUncovered.<anonymous#0> |
| 39.0 | 57.3 | 8 | 21 | 8 | 11 | `src/core/delivery/handoff.ts:63` readHandoff |
| 39.0 | 57.3 | 8 | 21 | 8 | 564 | `src/core/delivery/handoff.ts:179` readShortHandoff |
| 39.0 | 39.0 | 39 | 98 | 98 | 299 | `src/core/delivery/delivery.ts:192` createDelivery.deliver.<anonymous#0> |
| 30.0 | 30.0 | 12 | 50 | 64 | 4 | `src/core/delivery/format.ts:378` livenessTitle |
| 30.0 | 30.0 | 5 | 0 | 0 | 0 | `src/core/delivery/stopped.ts:112` stopHolds.<anonymous#0> |
| 30.0 | 30.0 | 5 | 0 | 0 | 0 | `src/core/delivery/stopped.ts:131` treePrint |
| 30.0 | 30.0 | 5 | 0 | 0 | 0 | `src/core/delivery/stopped.ts:154` listedPaths |
| 30.0 | 30.0 | 5 | 0 | 0 | 0 | `src/core/delivery/uncovered.ts:77` readByTests |
| 29.1 | 29.4 | 29 | 96 | 92 | 813 | `src/core/delivery/delta.ts:146` planDelta |
| 23.0 | 23.0 | 23 | 96 | 97 | 288 | `src/core/delivery/edits.ts:124` editNotes |
| 20.0 | 20.0 | 4 | 0 | 0 | 0 | `src/core/delivery/attribution.ts:247` withFlaky.runOf |
| 20.0 | 20.0 | 4 | 0 | 0 | 0 | `src/core/delivery/expiry.ts:148` dropLeft |
| 20.0 | 20.0 | 4 | 0 | 0 | 0 | `src/core/delivery/handoff.ts:79` liveHandoff |
| 20.0 | 20.0 | 4 | 0 | 0 | 0 | `src/core/delivery/handoff.ts:156` endHandoff |
| 20.0 | 20.0 | 4 | 0 | 0 | 0 | `src/core/delivery/leaving.ts:40` leavingMarks |
| 20.0 | 20.0 | 4 | 0 | 0 | 0 | `src/core/delivery/stopped.ts:100` stopHolds |
| 19.7 | 24.6 | 19 | 88 | 75 | 1283 | `src/core/delivery/delivery.ts:151` createDelivery.deliver |
| 19.0 | 19.0 | 7 | 38 | 45 | 504 | `src/core/delivery/liveness.ts:211` asTold |

functions never called: 37; of them CC>=5: withFlaky.<anonymous#2>(9), tellUncovered.<anonymous#0>(6), stopHolds.<anonymous#0>(5), treePrint(5), listedPaths(5), readByTests(5)
