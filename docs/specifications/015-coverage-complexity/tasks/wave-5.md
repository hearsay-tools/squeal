# 015 wave 5: coverage's main-thread share holds, and a replaced record is judged again

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.305. One worker, two rows in order: both edit `src/core/code/crap/`.

## W1: 015-45, then 015-44

Use /worker. Shape: repair. Starts from main at 0.1.305. Outcome: no coverage turn holds the daemon's main thread over 100 ms, coverage's writer and judge together stay near half of it, and a new record at a judged key re-judges its sources.
- Read `spec.md` D8 to D10, `status.md` (2026-10-25 lines), `reviews/0.1.305.md` S1 and S2, `tasks/015-42/notes.md`, and the board rows 015-44 and 015-45.
- **015-45.**
  - **Cold read.** Build the loader map in budgeted slices, with its result lookups and closure walk, and keep it private until it is whole (lead: `readLoaders` in `crap/loaders.ts`, its call in `crap/step.ts`).
  - **One budget.** One `Pace` shared by the writer and the coverage step (`coverage/writer.ts`, `code/pass/index.ts`, `coverage/pace.ts`).
  - `test/code/crap/chain-load.test.ts` read 76, 325 and 94 ms on GitHub's runners. After the slicing it keeps its 100 ms budget with margin.
- **015-44.** A cheap identity per stored record, which the code store reads without the blob, enters the summary signature (lead: `signatureOf` in `crap/`, `src/core/code/store/coverage.ts` and `schema.ts`). A new column needs a migration that keeps existing stores readable.
- **Owns.** `src/core/code/coverage/**`, `src/core/code/crap/**`, `src/core/code/pass/index.ts`, `src/core/code/store/**`, and their tests. By agreement (2026-10-25, the worker's request): one commit in `src/core/daemon/daemon.ts` that creates one `Pace` and passes it to `createCoverageWriter` and `createCodePass`; nothing else there. Leave `src/core/scheduler/**` and `src/core/watcher/**` alone (011). Ask me before you change a record's bytes, `COVERAGE_PROVIDER_VERSION` or a result key.
- **Done when.** Each row's done-when on the board is a test, red first. Each row is its own commit. The cold read is measured on an incident-size corpus, with the load. Notes go in `tasks/015-45/notes.md` and `tasks/015-44/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.
