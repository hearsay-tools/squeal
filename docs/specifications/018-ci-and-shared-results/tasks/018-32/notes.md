# Row 018-32 notes: status reports shared results correctly

Worker 55048193, 2026-11-11. Commit `b0fe2262b`.

## The new default line

`Imported results from <source>: N of M test files match this worktree[; the environment differs for E (a; b; k more in squeal status --full)]`

- Only the newest import with a test file here: `readImports` order, newest by import time (`listImports`: `imported_at DESC, id`). Not commit order: status has no cheap ancestry, and D19's line (`sharedOf`) already takes `imports[0]`, so both lines talk about the same import.
- N = `currentFiles + sameKeyKept + sameKeyNotAdopted`: every file whose key here equals the import's. The brief named `sameKeyKept`; I added `sameKeyNotAdopted` because those keys match too, and leaving them out makes the line read "0 of M" in the seconds between an import and the daemon taking it.
- Silent when N = M (D15: silent when an import works). In practice the line shows whenever the worktree's content moved from the import's commit.
- The environment part only when a blocking difference is named, with the count of files the environment keeps apart, so a mix of reasons is not read as the environment's alone (the concern of review wave-1-2 N1, whose "silent on a mix" rule this row retires).
- `--full` keeps every import.

## Item 3: blocking differences only

`environmentOf` (`imports.ts`) names `blockingDifferences` (`import-environment.ts`, over `importDifferences`), never `describeDifferences`. A project that D10 finds equal names nothing and gives no Node gap. It compares only files whose recorded environment is not this worktree's: a re-keyed file records this worktree's hash (D11, `transfer-import.ts` `recordFiles`), a file not re-keyed records the export's. Before, the map kept the last file per project, so a project whose last file was re-keyed named nothing.

When files read "environment differs" but nothing blocks (only D10 fields differ: an import from before 0.1.431, or a file the import could not re-key), `--full` says `N environment differs (only in fields an imported pass may differ in, but the import kept the export's keys)`.

## Item 4: D19

With `shared.ref` set and the newest import on another Node (`shared.node` present): a Node-only import gets no line of its own (as before); otherwise the import line drops the Node difference (`isNode` matches `describeDifferences`' text `Node <x> in the export, <y> here`, with or without a `project: ` prefix). Without `shared.ref`, Node stays in the import line.

## Observed in `~/projects/cezar` (read-only `squeal status --full --json`, Squeal 0.1.435, 20:5xZ)

HEAD 5b278bdc. The newest import (run 43089887527, at 5b278bdc itself) reads 31 same key kept, 45 environment, 2 closure, 21 observed, 1,424 content differs; status counts 6,251 checks stale. The new line would say "31 of 1523 test files match this worktree"; at the brief's moment (newest at 67ae4684) it says "1440 of 1523". 1,424 "content differs" at the import's own commit looks like the daemon's keys lagging the checkout (stale checks), not a status fault; not checked further (daemon and `src/core/shared/*` are outside this row).
