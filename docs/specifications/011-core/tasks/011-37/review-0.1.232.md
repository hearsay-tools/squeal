# Review of cand/0.1.232: the validity path refactored, and the alarm in place of the guard

Use /reviewer. Shape: review. Pinned to the `cand/0.1.232` SHA named in the spawn. The range runs from the base named there to that SHA. It holds three rows, cherry-picked with `-x`: 011-40 (three harness commits, then three moves), 011-47 (the barrier's narrowing into `stability.ts`) and 011-41 (the alarm). Then come this brief and the release commit (0.1.232 and the bundles). `KEY_FORMAT_VERSION` stays 20.

Read rows 011-40, 011-41 and 011-47, their briefs (`tasks/011-37/briefs.md`, with the amendment "011-41 and 011-47 after 011-40"), `tasks/011-37/design.md` sections 2, 3 and 6 (risk 4 as amended), C3, C12 and C14, 011 `status.md`'s 2026-10-20 lines for 011-40 and 011-41, both rows' `notes.md` and `../../reviews/format-18.md`. Check that:
- the three moves and 011-47 change no behaviour. The scheduler's and runners' tests pass unchanged, and the comparison against `squeal--v0.1.231` finds every case equal, with no uncovered line;
- the coverage rule counts changed lines per path, under the three conditions in `status.md`. Check it against format-18's B1 repair (the per-process V8 reports): a moved line must run in some case at the side that holds it;
- the decisions taken under D1 (a) hold: an overlay on `acceptedAt`, `heldFailure` or `stateFromResult` fires the alarm and must run its changed line. The `store` and `adapter:vitest` verdicts read by direction (`verdict.ts`, `byDirection`). The 17 to 18 one-off passes. Say whether a weakened rule can now pass unseen, and what catches it;
- the launchers left out of the alarm are pinned by `test/keys/launchers.test.ts`;
- D6 and the list's rule are enforced, and `KEY_SOURCES_HASHES` and `key-sources.ts` are gone with nothing left reading them;
- risk 9's install (`lock.ts`) runs only when lock lines moved and cannot reach a real `HOME` beyond npm's cache;
- the notes' decision 5 holds: node:test and pytest have no case kind, so code their entries bundle cannot change until one exists (row 011-48). Name each planned row it blocks.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. Name each file that fails under load and passes alone. Write `reviews/0.1.232.md` with a PASS or FAIL verdict and commit it.
