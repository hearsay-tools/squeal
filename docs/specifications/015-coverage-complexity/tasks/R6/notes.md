# R6 notes: repair of review 0.1.297 B1 to B4 and S1, the coverage judge (015-12)

Brief "R6" in `../wave-2.md` (read from `origin/main`), findings `../../reviews/0.1.297.md`, spec D9 with its 2026-10-24 amendments, `../015-12/notes.md`. Starts from `int/015f-r1`. Worker b822c832 repairs B5 beside this in `pass.ts` and `src/core/delivery/code-*.ts`; this repair does not touch them.

## What changed, per finding

| Finding | Change | Red first, then green |
| --- | --- | --- |
| B1 | `signatureOf` in `crap/step.ts` hashes `crap.threshold` and the counter version beside the blob and the loaders' keys. A threshold-only change re-judges; `kindOf` already keeps a crossing only the threshold made quiet. | `validity.test.ts`, "raised" and "lowered": 0 files judged, then 1. |
| B2 | The counter version is in the signature. A recount (`reseed`) marks every file in the summary's new `quiet` list; a quiet file skips the signature cache, and its judgement records no crossing from a judged state (`Judged.quiet`). A file leaves the list only when judged, so a record that comes later is quiet too. `seed` still gives new names a `pending` state. | `validity.test.ts`: a renamed function (`newName pending -`), a changed CC with the record ready and with a new key and record (`crap pass-to-fail cold`), a record that comes after the recount (a transition, and the delivery's FAIL line); the last test also proves the marker is spent: the next edit tells its recovery. |
| B3 | `readLoaders` reads each listed test file's closure and key from this worktree's key index, `Scheduler.keyIndex()` (`ClosureIndex` in `types/scheduler.ts`), never the main store's newest `test_files` row. A key the `test_file_keys` row does not hold yet waits (`run`). A listed test file with no closure in the index, or no index yet, is a pending loader of every source, reason `imports`; status says `N files wait for the imports of M test files` (`code.coverage.waitingForImports`). | `own-closures.test.ts` (5): the review's two-worktree case with A's loader queued, a source only the other branch's closure names, a row behind the index, a missing closure that then arrives, no index. All 5 fail on the old code. |
| B4 | `crap/join.ts`: a V8 function joins a counted function only when it holds no counted function outside it (a class's field initializer no longer joins the last arrow). A function with no V8 function did not run when the V8 function that holds it has hit 0; else its own lines strictly inside its body tell it; else `ran: null`. `null` makes both states `unknown`, with no crossing into or out of them. Then, by the coordinator's agreement, the record: `coverage/map.ts` keeps one entry per mapped span and hit, no longer one per start with the hits joined, and `COVERAGE_PROVIDER_VERSION` is 2. A joined span that another entry holds with the other hit reads `null`; an enclosing span counts as run when either of its entries ran. | `lazy.test.ts` (4) on real records, red on Node 22.23.3 and 24.21.0 with the old join, green on both now; its constructed `One` (one arrow field) was red on Node 24 until the record change; `join.test.ts` (`twice` with no V8 function reads `null`); `step.test.ts` (unknown states, no crossing). |
| S1 | `conditionAt` in `crap/loaders.ts`: a result past its record wait while the writer is busy stays `pending` with a wake `BUSY_RECHECK_MS` (5 s) ahead, never in the past. `onStored`, `busy()` and the 100 ms coalescing are as they were. | `pass.test.ts`: 75 coverage steps in 100 ms on the old code, 1 now; `step.test.ts`: `wakeAt` is now + 5 s. |

## Agreements outside the owned files

- `src/core/scheduler/scheduler.ts` and `src/core/types/scheduler.ts`: the read-only `keyIndex(): ClosureIndex | null` (request 6cc829a7, option (a)). Nothing else in the scheduler.
- The coordinator's condition on B3: status names the wait for imports, and a test shows a source leaves pending once the closure comes. That put an additive line in `src/core/status/code-status.ts` and the optional `waitingForImports` in `src/core/types/code-delivery.ts`.
- `test/version-sensitive.txt`: `test/code/crap/lazy` (request 93d4e377, option (a)), so CI's Node 24 job runs B4 too.
- `src/core/code/coverage/map.ts`, `record.ts`, `types.ts` (015-11's): the record keeps two V8 functions at one span with different hits, `COVERAGE_PROVIDER_VERSION` 2 (the coordinator's message after the residue report).

## For the release

`COVERAGE_PROVIDER_VERSION` 1 to 2 is part of a coverage-on key (`{ provider: "squeal", version }`), so with `coverage.enabled` every Vitest check re-keys once after the upgrade, and the coverage step seeds every `crap` and `uncovered` state `pending` again (its summary's `provider` differs), so their first judgement is quiet. Records of version 1 are not read again; the prune removes them with their results. With coverage off nothing changes. `test/keys/key-format.test.ts` and `test/keys/validity/*` pass at version 2.

## Seam map

| Piece | File | Note |
| --- | --- | --- |
| Validity | `crap/step.ts` `signatureOf` | blob, `counter <v>`, `crap <threshold>`, loaders' keys. |
| Quiet recount | `crap/summary.ts` `CoverageSummary.quiet`, `crap/step.ts`, `crap/judge.ts` `Judged.quiet` | Paths, sorted; absent when empty. |
| Own closures | `types/scheduler.ts` `ClosureIndex`, `scheduler.ts` `keyIndex()`, `daemon.ts` (`coverage.closures`), `pass/index.ts`, `crap/loaders.ts` | The index is `KeyIndex`, which holds what this worktree's keys were made from (bootstrap keys from the stored closure first; a hit is safe because equal keys mean equal contents, 001 B1). |
| Imports wait | `crap/loaders.ts` `PendingReason`, `crap/file.ts` `REASONS`, `crap/summary.ts` `withoutImports`, `crap/status.ts`, `status/code-status.ts` | Order: imports, run, record. |
| Join | `crap/join.ts` `matchEntries`, `enclosing`, `ranIn` | `JoinedFunction.ran` is `boolean | null`; `FunctionCoverage.unresolved`. |
| Busy wake | `crap/loaders.ts` `BUSY_RECHECK_MS` | |

## V8's records of the review's source

`export class Fields { a = () => 1; b = () => 2; }` on line 2, counted `Fields.a` at columns 26 to 32 and `Fields.b` at 39 to 45 (0-based, end inclusive):

- Node 24.21.0, never constructed: one entry `[2,22,2,45,0]`, the field initializer from `a` to the last arrow's end. The old join gave it to `Fields.b` (same end) and credited `Fields.a` from line 2.
- Node 24.21.0, constructed: `[2,22,2,45,1]` and `[2,35,2,45,0]` (`b`'s arrow). `a`'s arrow maps to the initializer's start, so `coverage/map.ts` keeps one entry for both. `Fields.a` now reads `unknown`.
- Node 22.23.3, never constructed: `[2,20,2,48,0]`, the initializer with its braces; no join, both arrows credited from line 2 before.
- `export class One { only = () => 1; }` on line 4, constructed, version 1 record: one entry `[4,19,4,32,1]` on Node 24, the initializer and the arrow joined at one span, so the old record read `One.only` as run. Version 2 keeps `[4,19,4,32,0]` and `[4,19,4,32,1]`: `One.only` reads `unknown`. It also keeps `Fields.a`'s own `[2,22,2,32,0]`, so `Fields.a` reads not run instead of `unknown`. Node 22 gives the initializer its braces (`[4,17,4,35,1]`) and the arrow its own `[4,19,4,32,0]`: not run.

## Decisions the spec did not settle

1. **A recount's quiet marker lasts until the file's first judgement**, whatever reason the recount had, an edit to the file after the recount included: that judgement mixes the counter's change with the edit, and a crossing the counter made would read as the edit's. A function an edit added still gets a first-seen fail. Every file is judged again after a recount, once (the 50 ms slices spread it).
2. **A test file with no closure in the index is a pending loader of every source** (the coordinator's condition), never "no loader", and never `unknown`: its closure is expected to come.
3. **An unresolved join is `unknown`**, not the last judged state, so status never shows a pass the record cannot back. Like complexity's parse errors, no transition goes into or out of `unknown`.
4. **5 s for the busy-writer wake**: the step after a no-op costs about 20 ms here (015-12's notes), so 0.4% of a core while a large batch maps; `unknown: no-record` reads at most 5 s after the writer goes idle.

## Residue for the next worker

- **On Node 24, a class with one arrow field, constructed and the arrow never called, reads `unknown`, not "not run".** Its two V8 functions share one mapped span, so the record cannot say which one ran. Telling them apart needs the generated positions, which the record drops.
- **Generated functions that map to one source span with different hits now read `unknown`** where version 1 joined their hits. The source map maps a generated position to the last segment before it, so a transform's helper can land on a function's span. The fixture records show none; a dogfood count of `unknown` CRAP states would show how many.
- **`ran: null` reads `unknown` for every single-line function the join misses** (no V8 function joined, no enclosing zero-hit one, no body line). On the fixture records every function joins; a dogfood count of `unknown` CRAP states would show how many others there are.
- **The main store's `test_files` row is now read by no coverage code.** Status's `notRead` and the CLI read the policy, not closures.
- The residue in `../015-12/notes.md` still stands: no `STILL FAIL` for `crap` or `uncovered`, `complexity.blocking` and `--told` count complexity only, no summary line for a `crap.threshold` change.
- **Bundles not built** (the brief): `plugins/*/dist` drift fails the bundle tests.

## Type changes (all additive)

- `Scheduler.keyIndex(): ClosureIndex | null`; `ClosureIndex` (new, `types/scheduler.ts`).
- `CodePassOptions.coverage.closures: () => ClosureIndex | null` (required beside `main` and `writing`); `CoverageStepInput.closures`, `LoaderInputs.closures`; `LoaderInputs.main` no longer needs `testFiles`.
- `PendingReason` (`"imports" | "run" | "record"`, new); `Loaders.withoutImports`; `BUSY_RECHECK_MS`.
- `CoverageSummary.quiet?`, `CoverageSummary.withoutImports?`; `FileSummary` pending `reason: PendingReason`.
- `Judged.quiet?`; `FunctionCoverage.unresolved?`; `JoinedFunction.ran: boolean | null` (was `boolean`).
- `MappedScript.functions` keys by span and hit (was by start); `COVERAGE_PROVIDER_VERSION` 2.
- `CodeCoverageStatus.waitingForImports?: { files, testFiles }`.
