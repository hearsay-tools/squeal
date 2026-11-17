# 005 wave 24: the first delivery after the listing seeds the view as a registration does

Row 005-113. The human, 2026-11-17: "Start now". Coordinator: session 4d2ecbfc. One worker.

Rules: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report (`squeal status --wait 60000 <path>...`); the three bundle tests (`test/harness/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`) fail on drift until the coordinator builds, which is expected. Run a Vitest file directly only where Squeal does not cover it, one at a time, `timeout 900`. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names. Never run a script under `evals/bin`.

## W1: 005-113

Use /worker. Shape: slice, cause first. Outcome: a session that registered before its worktree's test files were listed gets, at its first delivery after the listing, a write no larger than a registration at that moment, so that delivery finishes inside a 2 s hook on a large store.

Read first:
- `../../011-core/research/unlisted-after-start.md`, sections 1 and 5 (R1) and its probe `probes/unlisted-after-start/owed-delivery.ts`.
- `../research/boundary-hook-cost.md`, section 2 and row 2 of its ranked table: served by a daemon, the owed first delivery takes 8.3 to 12.2 s on a copy of a large store, fails with "no answer from socket in 1000 ms", writes nothing and repeats at every boundary; a 005-106 registration at that moment takes 0.60 to 0.62 s.
- `../tasks/005-106/notes.md` and `../research/consumer-view-design.md`: the birth mark, the seed of the rows not `pass`, the equivalence test with the full copy as the reference.

Cause, as the research reads it (confirm it in a test before you change code): a consumer registered before the listing has a birth mark older than every state the listing commits, or none. Its first delivery after the listing plans a delta over every state and tells its view one row per never-told state (`src/core/delivery/delivery.ts` `plan`, `deliver`, `payCounts`; `src/core/delivery/delta.ts` `planDelta`; `src/core/delivery/counts-owed.ts`).

Contract:
- At the first delivery to a consumer owed the counts (it registered before the listing), the delivery seeds the view as `registerNow` does at that moment: the rows not `pass` and a new birth mark. Then it plans the delta from that view. One owner for the seed: call the code 005-106 landed (`statesToSeed`, `seedView`, `src/core/store/view-seed.ts`, `view-mark.ts`); do not write a second seed.
- The text is unchanged: the owed counts are said once, as today; failures that exist at the listing are told as today ("known failures", inherited); a failure inherited from before the session is never told as a regression of this session, and a pass is never told as news.
- A store with no birth marks (an older daemon serves it) keeps today's full write.
- The write and the mark commit in one transaction with the delivery; a killed hook leaves either all of it or none.
- Mixed versions: say in your notes what an older release's hook reads from a view this delivery seeded, as 005-106's notes did.

Owns: `src/core/delivery/{delivery,delta,counts-owed,view-mark}.ts`, `src/core/store/{view-seed,state-born}.ts`, their tests, one sentence of `docs/specifications/001-core-loop/spec.md` D6 if the rule changes (propose it in your notes; the coordinator lands spec text). Leave alone: `src/core/presence/**`, `src/core/delivery/{header,format,late*}.ts` (row 005-111, another worker, not landed yet), `src/core/store/sending-connection.ts` and the write desk (rank 1 and 4 of the research, not chosen yet), `src/harness/**`. 005-111 changes one line of `tellAtRegistration` in `delivery.ts`; stay away from that function.

Done when:
- a failing test first: a consumer registered before the listing, N states committed, the first delivery writes one view row per state on main; with the fix it writes only the rows not `pass` plus the mark;
- the equivalence as a repository test: random runs of register, list, deliver, state changes, with the full write as the reference, 0 differences in the told entries and in later deliveries (reuse 005-106's generator);
- cases: an inherited failure, a failure born at the listing, a pass born at the listing, a store with no birth marks, two sessions of which one registered after the listing;
- timings at 50,000 synthetic states, before and after, with the host's load at that time, in `tasks/005-113/notes.md`; no artificial load;
- `test/keys/key-format.test.ts` passes (say if the validity bundle changes).

Final message: the cause with file and line, the commit, the timings, check results with their commands.
