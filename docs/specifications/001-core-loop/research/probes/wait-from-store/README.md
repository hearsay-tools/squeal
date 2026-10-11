# Throwaway probes: wait-from-store

**Throwaway.** Nothing here is product code. These files exist only to produce the evidence in `../../wait-from-store.md` (task 001-256). Delete them freely.

They run the real scheduler, Vitest adapter, store and sink (`test/scheduler/helpers.ts`) and the real `waitForStatus`, at commit 8e5e5462. Only the wait's `sync` is replaced:

- `shadow.ts`: a prototype store record, one entry per test file and re-key revision, open or resolved at a commit sequence number, plus `caughtUpAt` and a `dropped` watermark. Knobs: `perFile`, `openOnly`, `noReopen` and `ageOnly` are the controls; `now` shifts the commit clock.
- `mock.ts`: the `vi.mock` factory that wraps `recordRekeyed`, so every `Ledger.commit` writes the prototype in its own transaction, after the real record.
- `store-sync.ts`: the `sync` a store-read wait would use. It takes the captured revision, reads the commit sequence beside the wait's start view, then polls the store until its refined revision covers the capture and reads the answer in that one read transaction.
- `13k-b1`, `13k-s1`, `later-discharge` (13l S1, 13q S1, 13s B2, 13t S1), `13r-b2`, `d5-backstop`: one probe file per review case, each with a control that fails the way the review's reproduction failed.

Run from the repository root after `npm ci`:

```sh
npx vitest run --config docs/specifications/001-core-loop/research/probes/wait-from-store/vitest.config.ts --reporter=verbose
```

Recorded run, 2026-10-11, Node 24.21.0, Vitest 5.0.3, load average 54 to 75 on 24 CPUs: 5 files, 13 tests passed, 62 s.
