# 015 wave 6: the seed is sliced, and the chain-load test stops failing on runner speed

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.309. One worker.

## W1: 015-47

Use /worker. Shape: repair. Starts from main at 0.1.309. Outcome: no coverage turn holds the daemon's main thread over 100 ms at a recount or at coverage's start, and `chain-load.test.ts` no longer fails CI on a slow runner alone.
- Read `spec.md` D9 ("First judgement") and D10, `status.md` (2026-10-25), `tasks/015-45/notes.md` (Residue), `reviews/0.1.309.md` (Inputs for the next wave), `reviews/0.1.297.md` and `reviews/0.1.297-r2.md` (B1, B2: the start and reseed rules), and board row 015-47.
- **First commit, the test.** `test/code/crap/chain-load.test.ts` asserts 100 ms off CI and 250 ms when `process.env.CI` is set. Its log line stays as it is. The 200-sources case read 63 to 119 ms on GitHub's runners at 0.1.309.
- **The seed.** The seed's progress (the list of `crap` states, the counts per file, the upsert of pending states) outlives a step, within `STEP_BUDGET_MS`. No file is judged before its functions are seeded. A recount's judgement stays quiet (R6). Lead: `crap/seed.ts` and its call in `crap/step.ts`.
- Keep one daemon-owned `Pace`. Keep every result or record notification able to revoke a partial map or seed at once.
- **Owns.** `src/core/code/crap/**`, `src/core/code/pass/index.ts`, `src/core/code/store/**`, and their tests. Ask me before you edit anything else, or change a record's bytes, `COVERAGE_PROVIDER_VERSION` or a result key.
- **Done when.** The row's done-when on the board is a test, red first. The seed is measured on 011-197's stores, with the load. Each part is its own commit. Notes go in `tasks/015-47/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.
