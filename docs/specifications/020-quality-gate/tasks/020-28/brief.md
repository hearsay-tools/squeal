# 020-28: the gate keeps finished results when the store is busy (#192)

Use /worker. Shape: slice. Approved by the human on 2026-11-12 ("Fix it").

Outcome: `squeal code --base` prints its report before any store wait, then keeps its completed files with a 30 s bound, and when the bound runs out its note names the lock holders and how many files the next run will run again.

Read: spec 020 D17.3 and the new D17.5; `research/issue-192.md` (whole file, its probe under `research/probes/issue-192/`); spec 021 D1, D5, D15 (store bound and holder names).

Start: `src/core/code/gate/keep.ts` (`#write`, one deadline per runner run, the fixed busy note at about line 193) and `src/core/code/gate/collect.ts` (the keeper is called after each runner's run, about line 193). First edit offered as a lead: let the keeper queue each run's keepable files, and add a `flush` the CLI calls after the report is written (`src/cli/code-gate*.ts`); the wait and the note go there.

Owns: `src/core/code/gate/keep.ts`, `keep-expected.ts`, `collect.ts`, `src/cli/code-gate*.ts`, their tests under `test/code/gate/` and `test/cli/code-gate*`, `docs` copies of the gate's command text if the note is quoted there.
Leave alone: `src/core/store/*` (spec 021, coordinator 52f4f62a): use `whileBusy`/`busy.ts`, `sliced-write.ts` and `lock-holders.ts` as they are; ask the coordinator before any change there. Never hold a transaction across an `await`.

Done when (tests): a lock freed within 30 s after the report keeps every file, and a second run reads them from the stores; a lock held past the bound gives one note with the holder's pid and command and the count of files not kept, and the next run runs them; with no lock nothing changes; the report (plain and `--json`) is complete before the wait; exit code and verdict equal in all cases; a file whose keyed inputs changed before the deferred write is not kept. Lint, typecheck and `squeal status --wait 60000` on the changed paths. No `pnpm run build`, no full suite.
