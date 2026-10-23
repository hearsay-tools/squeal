{"files":607,"functions":7072,"ms":2001,"p50":2,"p90":7,"p99":19,"max":76,"buckets":{"1":3226,"2-4":2541,"5-9":925,"10-19":318,"20-29":38,"30+":24},"increments":{"control":8899,"andOr":2867,"nullish":1537,"default":340,"optional":1038,"logicalAssign":53},"at10plus":380,"at10plusWithoutOptionalNullishDefault":263}

| CC | without ?. ?? defaults | function |
| --- | --- | --- |
| 76 | 63 | `src/core/scheduler/tiers.ts:209` selectTier |
| 65 | 54 | `src/cli/status-wait.ts:254` waitForStatus.<anonymous#0> |
| 59 | 58 | `src/runners/observe/preloads.cjs:170` shellCommands |
| 58 | 46 | `src/core/scheduler/tiers.ts:646` recordTier.<anonymous#0> |
| 49 | 32 | `src/core/ps/measure.ts:62` measure |
| 42 | 36 | `src/cli/setup/format.ts:6` formatPlan |
| 42 | 33 | `src/core/scheduler/bootstrap.ts:120` baseline |
| 42 | 31 | `src/core/status/standing.ts:160` standingsOf.<anonymous#3>.<anonymous#0> |
| 40 | 32 | `src/cli/setup/questions.ts:56` answerPlan |
| 39 | 36 | `src/core/delivery/delivery.ts:192` createDelivery.deliver.<anonymous#0> |
| 38 | 38 | `src/core/daemon/protocol.ts:12` parseRequest |
| 37 | 34 | `src/core/scheduler/scheduler.ts:773` TierScheduler.#pump.<anonymous#0> |
| 35 | 32 | `src/core/scheduler/ledger.ts:254` Ledger.settle |
| 34 | 30 | `src/core/daemon/handlers.ts:166` createHandlers.<anonymous#0> |
| 34 | 25 | `src/runners/vitest/sources.ts:208` SourceStamps.stale |
| 32 | 32 | `src/cli/setup/command.ts:74` parseSetupArgs |
| 32 | 23 | `src/core/ps/flags.ts:111` daemonFlags |
| 31 | 24 | `src/core/ps/processes.ts:43` attribute |
| 31 | 31 | `src/core/ps/snapshot-unknown.ts:28` unknownOf |
| 31 | 22 | `src/core/state/header.ts:62` readHeader |
