# 011-116: an edit's transitive importers and readers share its cut, worker notes (2026-10-22)

Worker da5cf726, brief "## 011-116" of `../toolkit-latency.md`. Base: main at 782764fc5. Sources: 011 C4 step 4 (as amended for 011-25), `../../research/edit-cut.md`, `../../research/edit-latency.md` 3 and 6.1, `../../research/watch-mode-comparison.md` 3 and 5.2.

## The rule

A revision of fewer than 10 keyed paths keeps as an edit's work, as before, its added and edited test files and each changed source's namesakes (or, for a source with none, its direct importers). The `runner.tierSize` places that went to the shortest other direct importers now go to them first, then to the files that import a changed path through other modules or whose runs read it, shortest first, unknown last. A file a declared input alone reaches stays catch-up, and so does everything beyond the places.

## Seam map

- `src/core/scheduler/edit-cut.ts`, `editWork`: the candidates are two lists, each sorted by `shortestFirst`: the direct importers not kept, then the rest of `Ledger.recentOf(changed, direct)` that the runner names transitive (`EditCut.transitive`) or that `heldBeyondInputs` returns. The cap slices the joined list, so the count and order of direct importers are unchanged.
- `EditCut.transitive`: `fetchEditCut` keeps the `testFileId`s of `affected.transitive`. `cutAtStart` (a daemon start) gets it through `fetchEditCut`, so a start classifies alike.
- `heldBeyondInputs`: for each changed path, the files whose closure holds it (`reverse.referencing`), except those for which it is a declared input of their own (`keys.declaredFor(ref.path)`) and no run read it (`keys.observedOf(ref)`).
- `refinement.ts` and `bootstrap.ts` are unchanged: `demote` makes catch-up what `editWork` does not keep.

## Tests

| File | Done-when | Red on main |
|---|---|---|
| `test/scheduler/edit-cut-readers.test.ts` 1 | With every pool permit held by another holder and the lane waiting for quiet after a cancelled catch-up tier, an edit of `tools/cli.py`, which one test reads at run time, starts that test's tier with no grant within 5 s; the published quiet still waits at its start. | yes: the reader never became current within 5 s |
| `test/scheduler/edit-cut-readers.test.ts` 2 | The namesake and three direct importers fill the first edit tier; two transitive importers of 400 and 600 ms run in edit tiers; 40 files with `src/**` declared as input run as catch-up. | yes: the two ran in the catch-up tier |
| `test/scheduler/edit-cut.test.ts` 3 (three cases) and 7 (the abandoned call) | Where every direct importer was kept, the 4 shortest transitive files are kept too (`shortest4`), with a comment naming this row. | not applicable: these assertions changed |
| the rest of `edit-cut*.test.ts` | unchanged and green: the 4 shortest other direct importers fill the places there | |

The first draft of test 2 put fewer kept files than `tierSize` in the edit tier, and it passed on main: a file under 1 s fills a free place of an edit's tier from the catch-up group (`joinSpan`, `SHARE_FLOOR_MS`). The test now fills the first tier with kept direct importers, so only the cut can put the transitive files in an edit tier. In squeal's `s-body` case they waited because the tier was full, or because they were not comparable in time with its files.

## Decisions the spec did not settle

1. **Order.** Direct importers first, then transitive importers and readers. A merged order would let a 50 ms transitive file push out a 400 ms direct importer. The board's done-when asks for the direct importers' count and order to stay as they are.
2. **The cap counts others only, as under 011-25.** When a bare source keeps every direct importer as its fallback, the `tierSize` places go to transitive importers and readers. So a small revision's edit work can grow by up to `tierSize` files (test 3 of `edit-cut.test.ts`).
3. **Declared input alone.** A file is excluded when every changed path its closure holds is a declared input of its own that no run read, and the runner does not name it transitive. A path that is both declared and imported counts as imported when `affected.transitive` names the file. When the runner's graph does not name it (a JSON or snapshot path held both ways), the declared check decides, and the file stays catch-up.
4. **Observed reads count whether or not `observe.runtimeInputs` keys with them.** With the policy off, the observed path is in no closure, so the file is reached only when something else holds the path.
5. **Listings (coordinator decision (a), 2026-10-22).** Only an add or a delete in a directory moves its listing. `rekeyContent` (`revision.ts`) re-keys the files that list it through `keys.rekeyListings`. `Ledger.recentOf` does not reach them, so `settle` queues them as plain backlog, the second group behind catch-up, and `editWork` never sees them. This row leaves them so. Making them an edit's work needs `revision.ts`, which 011-117 owns in this wave. It would also make vim's `.x.swp` start an edit tier at once for every test that lists the directory. **A possible later row, after 011-117 lands:** listing-only re-keys of an add or a delete join the cut's places, with editor scratch names excluded first.

## Type changes

- `EditCut.transitive: ReadonlySet<string>` (additive; only `fetchEditCut` builds an `EditCut`).

## Cost

`heldBeyondInputs` reads, for each changed path, each file whose closure holds it: `declaredFor` (one array per rule set; it allocates a union when several `inputs` rules apply to a file) and `includes`. A small revision has at most 9 keyed paths, and cezar's largest reached 472 files, so this is small next to the runner part's calls. Not measured.

## Expected drift

No `npm run build` in this tree (brief). `edit-cut.ts` is in the bundles, so the four bundle tests fail until the coordinator builds at integration: `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts` ("cli/squeal.mjs differs from the build").
