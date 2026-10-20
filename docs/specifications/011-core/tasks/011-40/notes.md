# 011-40: the validity path's three refactors, notes

Row 011-40 is R3 of task 011-37's design (`../011-37/design.md`, section 5; brief `../011-37/briefs.md`). It makes three moves, each in its own commit, and each is proven by 011-39's comparison (`test/keys/validity/`): "the candidate against the last release" passes with no differing output and no uncovered line. The last release is `squeal--v0.1.231` (key format 20, with 19 read as one). Its `src/` equals this branch's base, `5c5aadea`.

## Commits

The harness commits come first, then the three moves, so 011-41 can start from any of them.

| Commit | What |
| --- | --- |
| `bdac0e06` | The `store` kind compares `recordTier`'s per-file decision at both trees, over six tiers, 013-01's test 11 (T1 and T2) among them |
| `98fa788f` | The `accept` kind compares the checks a hit retires (001 D8) |
| `a4498248` | A changed source line is changed by the trees, not by the bundle that holds it (the coordinator's three conditions, `test/keys/validity/notes.md` item 9) |
| `a1bb5b84` | Move 1: the accept rule leaves `Ledger` for `src/core/scheduler/accept.ts` |
| `3a671657` | Move 2: `recordTier`'s per-file decision leaves `tiers.ts` for `src/core/scheduler/store-decision.ts` |
| `47f9e968` | Move 3: Vitest's width hints leave the adapter class |

## Each move against the last release

Each run is `compareTrees` over the full corpus: the candidate at the commit against `squeal--v0.1.231`, extracted with `git archive`, as `compare.test.ts`'s "keeps every stored meaning, or raises" runs it. Squeal also ran `compare.test.ts` green at each commit. The one-minute load was between 38 and 71 on 24 CPUs.

| After | Fired | Cases | Differing | Uncovered | Time |
| --- | --- | --- | --- | --- | --- |
| `a1bb5b84` (accept) | yes | 30 | none | none | 3.8 s |
| `3a671657` (store decision) | yes | 30 | none | none | 4.6 s |
| `47f9e968` (Vitest hints) | yes | 30 | none | none | 3.9 s |

It fires from move 1 on, because the candidate's harness reads the new modules and the release's reads the old ones. Before move 1, the three harness commits leave `src/` as the release has it.

**Move 3 (Vitest hints).** The comparison's bundle holds no `src/runners/vitest/` source, at the release or at the candidate. Move 3 therefore changes no line of it, and its outputs are those after move 2. Its proof is that `test/runners/vitest/width.test.ts` and the other adapter tests pass unchanged (Squeal, at the commit), with the global comparison as after move 2. `adapter.ts`'s own bundle no longer holds `width.ts`, which was measured with esbuild's metafile over `src/runners/vitest/adapter.ts`. `index.ts`'s bundle still holds it. The per-adapter comparison that would see `adapter.ts` is 011-41's, together with the `adapter:vitest` kind and 013-01's tests 2 and 4 (the coordinator's decision of 2026-10-20).

## What moved, and what stayed

- **`accept.ts`.** `acceptedAt(store, worktreeId, key, now, listed)` holds `probe`'s rule: a hit stands; this worktree's own set stands at once; another worktree's unconfirmed fail holds the set back (`heldFailure`); a miss may wait only when no result is stored. It also holds the copy of a set read as one (`ResultRepo.copyNewest`). `now` is the clock, read twice as `probe` did. `listed` is a `ReadAsOne`: the key index's `keysReadAsOne` and the memo of keys read. `Ledger` keeps that memo (`#readAsOne`), and `rereadFormats` and `removeFile` still clear it. `currentChecks(previous, results)` gives `{ checks, retired }`. `Ledger.probe` and `lookup` are the one lookup path; both call `acceptedAt`, and 011-33's handover still settles through them.
- **`store-decision.ts`.** `tierEnd(tier, report, changedOnDisk, requeue, observed)` reads what a tier's end says of its files once: completed, withheld, cancelled, re-queued, not started, the split cap, the growth, environment growth, and the unstable predicate. `storeDecision(entry, end, held)` is a pure function of the file's entry, that end, and whether the ledger still holds the file as selected. It returns one of: `superseded`, `gone`, `withheld`, `requeue`, `not-started`, `unknown`, `split` (with its cap), `unstable` (with the paths), `first-seen` (with whether it re-runs), `environment`, `no-key`, or `store`. A `store` says where, the key it ran under or its growth's key, and whether the results become current. Completed decisions carry the growth to add first. `supersededIn` and `timeoutCap` moved with it, and `tiers.ts` re-exports `supersededIn` for `scheduler.ts`. The decision's bundle holds no queue, ledger or tier code: `timeoutCap` moved so that `queue.ts` would leave it. `recordTier` carries the decision out: the `Ledger` calls, the withheld reason, `addObserved` and the grown key, the records, `storeResults`, re-runs, setups and `markUnknown` with 011-27's `cause`.
- **`VitestHints`.** This is what the adapter tells of each instance it starts (`started`) and asks before each run (`size`). `VitestWidths` (`width.ts`) answers it, holding `Widths` and the run width without a grant (`maxWorkers`). `index.ts`'s `SizedVitestAdapter` answers `slowWidth` and `tierWidth` from it. `RunnerAdapter` is unchanged.

## Type changes

- New exports: `acceptedAt`, `currentChecks`, `ReadAsOne` (`accept.ts`); `tierEnd`, `TierEnd`, `storeDecision`, `StoreDecision`, `supersededIn` (`store-decision.ts`); `VitestHints` (`adapter.ts`); `VitestWidths` (`width.ts`).
- `timeoutCap` is no longer exported (from `timeout-split.ts`); it is private to `store-decision.ts`. Only `recordTier` called it.
- `VitestAdapter`'s constructor takes `hints: VitestHints` where it took `maxWorkers?: number` (the sixth parameter). `VitestAdapter.slowWidth` and `tierWidth` moved to the `SizedVitestAdapter` that `createVitestAdapter` returns. Only `index.ts` and `test/runners/vitest/broken.test.ts` (two arguments) construct the class. An adapter built without hints runs at its configs' own width.

## Decisions the brief did not settle

1. **How the release's harness reads code that moved.** A tree that lacks `needs` reads `before` in place of `module` (`bundle.ts`, `BEFORE_MOVES`). `harness/accept-rule.ts` falls back to `accept-rule-ledger.ts` (`Ledger.probe`, and retirement read from the sink's `retire` at `commit`). `harness/store.ts` falls back to `store-traced.ts`, which records the tier with the tree's own `recordTier` over a seeded ledger and reads each decision from the top-level `Ledger` calls before the first `settle`. Both entries go once the last release carries the moves.
2. **The `store` kind's vocabulary.** The names are what the traced effects can tell apart. `gone`, `no-key`, and a `first-seen` with no re-run due are all "nothing". `split` carries its cap; `unstable` carries its paths. `grown` and `current` are reported per file. The withheld reason (the barrier's `failure`) is wording.
3. **The barrier's narrowing is the scheduler's.** `Scheduler.#record` (`scheduler.ts:736-747`) picks the files whose inputs name a touched path, and `Withholds` decides first or exhausted; `withheldForTouch` (`stability.ts`, an entry) withholds them. The harness mirrors the narrowing (`harness/store-input.ts`), so a change to it there moves no comparison. Moving it into `stability.ts` would put it on the validity path. That is a follow-up outside this row's seams.
4. **Each decision reads its own copy of the stores a run wrote** (`compare.ts`, `storedFor`). A lookup writes: it copies a set read as one, and it sets a last-used time. The candidate's decision over the release's store had copied the read-as-one set to the key before the release's own decision ran. That decision then hit at the key, and the release's `#copyReadAsOne` lines showed as unrun.
5. **`timeoutCap` moved into `store-decision.ts`** (amended into move 2). The split cap is part of the per-file decision, and `timeout-split.ts` imports `priorityOf`, which kept `queue.ts` in the decision's bundle.

## Where the rows landed since the brief meet these seams

- **011-27** added a `cause` to `Ledger.markUnknown` and to `recordUnknownFiles`, and `{ cause: "timeout" }` to `recordTier`'s tail. All of that stays where it was: it is the execution, and `meta`'s unknown records are status, not stored results. The candidate's comparison bundle no longer holds `ledger.ts`, `tiers.ts` or `unknown-files.ts`. At the release they are bundled through the fallbacks and are unchanged on disk, so under item 9's rule no `cause` line needs a case. The board's note that those lines "stay uncovered by `validity/compare.test.ts` until 011-41" no longer holds: they are off the path.
- **001-431** changed `adapter.ts`'s `createVitest` env (`UNOBSERVED`) and `observe.ts`, which are inputs to Vitest's environment hash. Move 3 touches neither. They stay in `adapter.ts`, the entry of 011-41's per-adapter comparison.
- **011-25** (`edit-cut.ts`, `namesakes.ts`, `refinement.ts`, `bootstrap.ts`) decides which misses run as an edit's work. It reaches `Ledger.settle` through `direct`, which is queueing. That stays in `Ledger`, off the accept path.
- **011-26** changed status and CLI files only.

## The one-off at 17 and 18 (013-02's barrier cases)

`TMPDIR=/tmp npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.226 squeal--v0.1.228`, all kinds, 5.0 s, at a one-minute load of 71 on 24 CPUs. Both trees read the moved code through the fallbacks.

- Every `key`, `rows`, `observe`, `accept` and `assemble` case is equal, and so are five of the seven `store` cases.
- 013-01's test 11, T1 and T2, differ. At 18, `slow2` and `slow3` are stored (`store at ran:`); at 17 they are `unknown`, and `slow1` is the same at both (re-queued in T1, unknown in T2). This is 013-02's narrowing of the barrier (D2 of 013-01): 18 stores two files that 17 withheld. One caveat: at 17 the harness applies 18's narrowing of which files re-run once (item 3). 17's scheduler re-queued all three in T1, where the harness leaves `slow2` and `slow3` unknown. Either way 17 stores neither.
- 41 changed lines ran in no case. They are 011-38's reading-as-one code in `key-index.ts` (17 lines, at 18) and `keying.ts` (15 at 18, 5 at 17), plus `Ledger.rereadFormats` and the memo's clearing (4 at 18). The harness stubs `keysReadAsOne`, so the key index's own computation of the listed keys runs in no case.

What the comparison would say of that difference is open. The verdict counts any differing `store` output as a raise. Yet each row 18 stores for `slow2` and `slow3` is the row 17 stores for the same key on a run without the touch: what changed is whether a run stores, not what a stored row means. Risk 4 wants the same kind to fail on "stores an unstable file", which also stores more. That verdict is 011-41's (D6), for the coordinator. `KEY_FORMATS_READ_AS_ONE` holds 18, with 013-02's barrier named, on the reviewer's reading (design section 6: until R4 ships, a release's raise joins the list that way).

## What 011-41 must know

- **The guard fails on all three moves, as the brief expects.** In `test/keys/key-format.test.ts`: "is bumped whenever the guarded sources change"; "an adapter-only bump of `src/runners/node-test/version.ts` keeps the global pin" and the same for `src/runners/vitest/version.ts`; and "the guard fails on a change to `recordTier`". Move 2 moved the text that last test edits, `report.end === "completed"`, into `store-decision.ts`. Bundle drift fails as well, since `npm run build` was not run.
- **Risk 4's accept overlay cannot fail this comparison as it stands.** Under D1 (a), both compared decisions are the candidate's own `acceptedAt`, over each tree's store. An overlay that holds no fail changes both decisions alike, so it shows no difference. Measured against `squeal--v0.1.231`: no differing case, no uncovered line, no failure. The release's own decision runs for coverage only. A store-decision overlay ("stores an unstable file": `paths.length > 0` turned false) does fail, naming "every per-file outcome of a completed tier", because `store` is a run kind.
- **The entries table.** The candidate's bundle holds `accept.ts` and `store-decision.ts`, and no `ledger.ts`, `tiers.ts`, `queue.ts` or `timeout-split.ts`: 6,289 lines, where the release's has 8,007. `driver.ts` still re-exports only the entries 011-39 listed. `accept.ts` and `store-decision.ts` reach the bundle through the harness, so they would join the alarm's entries table when it moves.
- **The fallbacks go once the last release carries the moves**: `BEFORE_MOVES`, `accept-rule-ledger.ts` and `store-traced.ts`, and with them format 12's `probe` arity branch.
