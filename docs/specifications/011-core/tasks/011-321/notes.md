# Row 011-321: the key alarm reaches the run evidence module (notes)

Wave 92, W2. Source: review `011-core/reviews/0.1.453-r2.md`, N1. Tests only: no file under `src/` changed, and `KEY_FORMAT_VERSION` did not move.

## What changed

| File | Change |
| --- | --- |
| `test/keys/validity/entries/global.ts` | Two global entries: `observedMoves` (`src/core/run-evidence/sources.ts`), and `recordOutcome`, `runEnd`, `decisionOf` (`src/core/run-evidence/run-evidence.ts`). |
| `test/keys/validity/case.ts` | `StoreInput.reads`: growth paths that change or are touched during the run (additive, optional). |
| `test/keys/validity/harness/store-reads.ts` | New. The `store` kind with `reads`: writes and commits the growth paths, seeds a stat cache, changes or touches the paths, then runs `observedMoves`, `recordOutcome`, `runEnd` and `decisionOf` per file. |
| `test/keys/validity/harness.ts` | Dispatches a `store` case with `reads` to `storeReads`. |
| `test/keys/validity/harness/store.ts` | Exports `named` and a new `entriesOf` (the tier entries `storeCase` built inline). |
| `test/keys/validity/harness/store-input.ts` | `reportOf`: the run's report before the barrier, split out of `recorded`. |
| `test/keys/validity/cases/store/reads.ts`, `cases/index.ts` | The case "observed reads that changed or were touched during the run". |
| `test/keys/validity/reach.test.ts` | The mutation self-test. The barrier self-test (011-47) now also lists the new case and expects 3 failures: barring every file of a touched tier withholds the read that held still, which the release stores. |
| `test/keys/validity/compare.test.ts` | The 17->18 self-test (a barrier that bars nothing) now also reports the new case's touched file as stored. |

## The case

Three files, each with one read beyond its key. Its output at this tree:

- `test/changed.test.ts` (read `data/changed.txt` gets new bytes): `unstable: data/changed.txt`.
- `test/touched.test.ts` (read `data/touched.txt` gets a later mtime, same bytes): `requeue` (the barrier withholds it at its key for the first time).
- `test/still.test.ts` (read held still): `store at moved:…` (stored at the key with its growth).

Wording (never fails): the changed and touched sets `observedMoves` gave, and each file's reason from `decisionOf`.

## Mutation result

Overlay: in `observedMoves`, `return { growth, ...(await changedSince(before, paths, context.hasher)) };` becomes `return { growth, changed: new Set(), touched: new Set() };`.

- Before this row (commit `57b0eb3fe`): `result.fired` is `false`. The test failed with `expected false to be true` at the `fired` assertion. This reproduces N1.
- After: `fired` is `true`, `uncovered` is `[]`, and the new case reports two differences:
  - `test/changed.test.ts: unstable: data/changed.txt at the last release, store at moved:test/changed.test.ts at the candidate (the candidate stores more)`
  - `test/touched.test.ts: requeue at the last release, store at moved:test/touched.test.ts at the candidate (the candidate stores more)`

## Decisions the spec did not settle

1. **Named entries, not whole modules.** The entries name the four functions, not `export * as` of `sources.ts` or `run-evidence.ts`. Whole modules would put the keeper's composition (`readKeepEvidence`, `keepDecisions`, `runtimeAtEnd`, `UnmergedIndex`, `mergeHoldOf`) under changed-line coverage, and no case runs it. Then any later edit there would fail the alarm as uncovered. Esbuild tree-shakes named re-exports, so the bundle holds only what the four functions reach.
2. **The mutation is reported, not failed.** The `store` kind is read by direction (row 011-41). A candidate that stores what the release withholds is "reported (the candidate stores more)", not a raise. So the self-test asserts the firing, the coverage and the reported lines; it does not expect `failures()` to be non-empty. A weakened check that stores more is a correctness defect for the scheduler's own tests (risk 5), as for the accept rule in `reach.test.ts`.
3. **The extension is a field of the `store` kind, not a new kind.** A new kind would need a component's `kinds` list and a verdict reading. `reads` reuses the `store` kind's direction reading unchanged.

## Gaps left for a later row

- `readRecordEvidence` and `readKeepEvidence` (the compositions that join `observed.touched` into `RunEvidence.touched`) are not entries. Running them needs a `SchedulerContext` with a `Tier` (`rekeyEnvironments`, `scratchUnstable`) or `KeepSources` (stores, revisions, merge hold). The case joins the touched set as `readRecordEvidence` does, in the harness. An edit that drops that join still passes the alarm.
- The keeper's own decisions (`keepDecisions`, `keeps`) are outside the alarm, as before.
