# 011-33: a restart hands the queued work over, worker notes

Row 011-33 (011-30 R3, gh-47), brief W2 of `tasks/wave-6.md`. Base ec6337e6. Spec: 011 C4, "Explicit checkpoints" as amended 2026-10-20 (Q3 (a), Q5 (a)).

## Seams

- `src/core/scheduler/handover.ts` (new). `handover(context, ledger, previousKeys)` reads the work a predecessor left: each row of `previousKeys` (the worktree's `test_file_keys` before this daemon wrote any) whose `pending` is not `null`, and the open re-key move the store records for it. It returns `pending`, `first`, `catchUp` (sets of `testFileId`) and `changed`, the paths of the revisions that reached a first-group file. It reads the store's revisions over the moves' span once (`store.revisions.range(from - 1, to)`). It classifies each revision on its own, with `isCatchUp` and `Ledger.recentOf` over the current closures. A small revision's reach wins over a large one's (review wave 5, B3). A file no revision in its open range reaches, such as an environment's re-key, stays in the second group. A pending row with no open move recorded counts as open at its row's revision, which is how `recordMoves` takes rows in at a ledger's first commit.
- `src/core/scheduler/bootstrap.ts`, `baseline`. The enqueue loop no longer sits in the `else` of `onStart`. Under `lookup-only` it takes only the misses `handover` names. Under the default baseline it takes every miss, as before, and the handover's groups and `changed` join `unseen`'s. The lookup is the same `Ledger.settle` (`queueMisses: false`) as every miss, so the handover adds no lookup path. The baseline checkpoint is still abandoned under `lookup-only`. Handed-over files are queued outside it: they are an edit's work, not the baseline's.
- `src/core/scheduler/rerun.ts`, `restoreReruns`. The `queue` parameter is gone. A pending re-run at the file's key is queued forced whatever the policy (Q5 (a)).
- `src/core/scheduler/rekeyed-moves.ts`: an additive `openMoves(store, worktreeId)` reader. No type changed.

## Tests

- `test/scheduler/handover-queued.test.ts` (new), over the catch-up fixture (real store, fake runner whose runs honour a cancel). A predecessor runs everything, then a `lookup-only` daemon holds an edit's tier and closes with `cancel` (as `squeal stop` does), so the rows stay `queued`. Five cases, all red on ec6337e6:
  1. `lookup-only`: the edit's two importers run in one edit's tier (not granted) and are current.
  2. `lookup-only`, `config.json` (an environment-only re-key): all eight run in granted tiers.
  3. `lookup-only`, a 12-source catch-up revision, then `config.json`: the 24 catch-up files run before the 4 that only the environment re-keyed, all granted. This case is not in the design's four. The spec names the catch-up group, so it is tested.
  4. `lookup-only`, every key moved while no daemon ran (the runner's `adapterVersion`, which stands in for a key-format change): only the queued file runs, at its new key. The other 22 stay stale.
  5. Default baseline, keys moved the same way: the handed-over files lead an edit's tier and run nowhere else. The 22 misses follow in granted tiers. On ec6337e6 the first run was a granted backlog tier.
- `test/scheduler/rerun-restart.test.ts`: a new case. A new failure's pending re-run is run by a `lookup-only` successor. Red on ec6337e6: no run.
- `test/daemon/restart-handover.test.ts` (new), run 5's shape with the real CLI. The fixture is `lookup-only` with a held `test/hold.test.ts`. Steps: `start`, `run --all --wait`, hold on, edit, `stop` with the tier held, `start`. `status --wait 60000 test/hold.test.ts` is still waiting at 5 s. The successor runs the file. Once the hold is released the wait exits 0 with `Named test files at revision 1: no known failures; 1 test file, each with a current result`, about 0.6 s after the release. Red on ec6337e6: the wait returned within 5 s.

## What the design did not foresee

- **Tier sharing.** An edit's tier fills with second-group files of a comparable last-known duration (C4, `SHARE_RATIO`). Under the default baseline the handed-over files are therefore not alone in their tier. Case 5 checks that they lead an ungranted tier, not that they run alone.
- **Classification uses the current closures.** A revision in a file's open range counts only if it reaches the file through today's closure (`recentOf`). The closure at that revision is not used, because the store keeps no history of closures.
- **The open range is a span.** `[earliest, latest]` can hold revisions that never re-keyed the file. Those revisions do not reach it, so they do not count.
- **`changed` is a union.** It holds the paths of every revision that reached a first-group file. A file whose own path is in it ranks as edited within its group. This affects the class within a group only, never the group.
- **Not traced.** As the design's "What is not known" says, `takeHeldFiles` and a blocked project were not traced beyond this. A blocked miss is queued and then taken out by `block`, as before.

## Interplay with 011-38

011-38 (worker 09725721) owns `keying.ts`, `ledger.ts` and `stored-keys.ts`. This row edits none of them. The handover only chooses which of the baseline's misses to queue. A miss is whatever `Ledger.settle` found no result for. So once 011-38 reads formats 13 on as one inside that lookup, a handed-over row readable at an older format settles without a run and is never queued. If 011-38 reads older formats in a later pass instead (adoption), a queued file it settles leaves the queue there, as adopted hits do today. Either way there is one lookup path. A textual conflict is possible only if 011-38 changes the call site of the two `lookup(...)` calls in `baseline`. The enqueue loop below them is this row's.

## For whoever continues

- `test/keys/key-format.test.ts` and the bundle-drift tests are expected to fail on this guarded change. The row ships in the 001 coordinator's format-18 bundle, so there is no version bump, no `KEY_FORMAT_VERSION` change and no re-pin.
- Promotions are still not handed over (design, "What is not known"). R4's `handover-tier.test.ts` will exercise this row together with R1 and R2.
