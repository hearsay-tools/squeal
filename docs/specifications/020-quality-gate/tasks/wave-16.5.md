# Wave 16.5: repair of candidate 0.1.464 (review `reviews/0.1.464.md` FAIL)

## Wave 16 R1 (B1, S1)

Use /worker. Shape: repair. Base: `w16/land` at the commit that adds this file. Read `reviews/0.1.464.md` (B1, S1 and its repair inputs) and `tasks/wave-16-integration/notes.md`.
- B1: when an adapter run settles (completed, crashed or stopped), drain each still-outstanding file-start end callback of that run once, so a dead Vitest file gets no "still running" line; never silence files of lanes still running; keep `wasStarted` for `runs[].notStarted`. Regression: the reviewer's probe shape (a Vitest worker killed while a node:test lane runs on).
- S1 (fold in): a throwing node:test start or end hook must not leak a pool slot; release the slot on every exit path. Regression for it.
Owns: `src/core/code/gate/{collect,progress,lanes,runs}.ts` and the adapter hook call sites in `src/runners/vitest/reporter.ts` and `src/runners/node-test/run/run.ts` (only the hook wiring), their tests. If a hook line changes, rerun `test/keys/key-format.test.ts`; extend the validity cases under `test/keys/validity/**` rather than raise an adapter version.
Done when: both regressions red before and green after; lint, typecheck, key-format; `squeal status --wait 60000` on the changed paths. No build, no full suite.
