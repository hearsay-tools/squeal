# Wave 21 of spec 011

Two planned rows and the overdue quality scan, chosen by the coordinator on 2026-10-23 under the human's standing instruction ("If you are done with it before morning - grab the next piece yourself", 2026-10-22), from main with 0.1.273. The triage digest's rows (gh-64, gh-75 to gh-77) still wait for the human. Row 011-120 asks that coordinator 04a258b0 be told before it is briefed; this is that coordinator. W1 owns `tiers.ts`; R1 and Q1 edit no product file. The candidate is 0.1.274 unless another lands first. The 6b evals beside Q1 start only after the 07:00Z host-load measurement has taken its samples (about 08:00Z), since an eval run leaves its criterion C2 unmeasured.

## W1: 011-120, a cancelled forced run stays forced only while what forced it still holds

Use /worker. Shape: slice.

Outcome: after a revert, a file that a cancelled forced re-run left queued is no longer forced at its new key: it is looked up, reads current, and `run --all` completes at once. A forced `run --all --force` whose file a revision cancels still runs it forced at the new key.

Read board row 011-120; `tasks/011-118/notes.md` section 2; `research/edit-latency.md` section 1 (the toolkit-dev checkpoint held 13:23:01 to 13:27:06Z); spec 011 C4 step 5; 001-171 S1 ("a file whose key moves before its re-run runs drops it").

Seam: `recordTier`'s `requeue` branch in `src/core/scheduler/tiers.ts` (`:659` to `:664`). It passes the tier entry's `forced` to `ledger.enqueue`, and `settle` then skips the lookup of a forced entry (`ledger.ts:282`). A lead: keep `forced` only while the file is at the key the tier ran it at, or while a strict `run --all --force` checkpoint still holds it. Apply the same check to the 001-107 install-move `requeue` and to `requeueSplit` (`timeout-split.ts`).

Owns: `tiers.ts`, `timeout-split.ts`, the forced paths of `ledger.ts` and `queue.ts`, their tests, notes under `tasks/011-120/`. Not yours: `scheduler.ts` (row 011-128, planned), `src/core/status/`, the board, spec text, bundles, version. No `npm run build`.

Done when:
- After a revert, the file's row has no pending phase, `run --all` requests nothing and completes at once, and no further run starts. Show it with 011-118's probe state, by test.
- A `run --all --force` whose file a revision cancels still runs that file forced at the new key, by test.
- The re-runs of 001-171 and of a timeout split keep their meaning.
- Lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Paste their output in your summary.
- Squeal does not key the tests under `test/daemon/` on `src/` (row 011-127). Run the daemon tests your change can reach directly.

## R1: 011-127, what keys a test that builds the CLI at run time

Use /researcher. Shape: research. Brief: `research/cli-build-inputs-brief.md`. Findings: `research/cli-build-inputs.md`.

## Q1: quality scan of `squeal--v0.1.249..squeal--v0.1.273`

Use /quality. Shape: quality. Scan the work landed from 0.1.250 to 0.1.273 against `docs/vision.md` and `docs/styleguide.md`, as `quality/2026-10.md` did for 0.1.240 to 0.1.249 (row 011-100). Write `011-core/quality/2026-10-23.md`: drop candidates, duplicates and misplaced code, each with its file and line and a proposed row or slice. Edit nothing else.

Known candidates to confirm or reject:
- two `loadText` functions;
- one shared shell-quoting rule (`shellQuote` in `src/core/ps/render-units.ts`, next-step's and `squeal failures`' own rules);
- `src/core/scheduler/yields.ts` at about 400 lines and `src/core/status/standing.ts` at 420;
- the busy-store slice paths in `scheduler.ts` after 011-126.

Never run a script under `evals/bin/` or any `tasks/*/probe/`.
