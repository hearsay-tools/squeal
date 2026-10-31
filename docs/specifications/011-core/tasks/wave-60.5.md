# Wave 60.5: repair of review 0.1.382 (B1, B2)

Coordinator 339e9539, 2026-10-31. Review `reviews/0.1.382.md` FAIL on `cand/0.1.382` `a4821729c`: two proven blockers, both wording that claims more than the recorded state. Host policy as in `wave-60.md`. No `pnpm run build`; not yours: board, spec, `status.md`, bundles, version.

## RP1: B1 (row 011-272) and B2 (row 011-271)

Use /worker. Shape: repair, two commits, B1 then B2, on the candidate.

Read: `reviews/0.1.382.md` B1 and B2 (each has the reproduction and the bounded fix); `tasks/011-271/notes.md`, `tasks/011-272/notes.md`.

B1: `waiting: slot` is published both for the shared worker pool (`slow-tier.ts:260`) and for the slow slot (`:296`). Seam: `holdText` in `src/core/retry/text.ts:105` (one renderer for receipt and status). Words for `slot`: waiting for capacity, and that whether the slow slot or the shared worker pool holds it is not known. No new scheduler field. Add the free-slot, full-pool regression; keep the occupied-slot, failure-count and JSON assertions.

B2: `src/cli/run-slow.ts:77` says "so no slow file has a result". Say only what is known about the request: it is pending, and this command has no verdict for it. Keep the request id, exit 3 and the next command. Fix the expectation in `test/cli/run-slow-accept.test.ts:149` and add a case where a slow file already has a current result.

Owns: those files, their tests, a section R1 in each row's notes. Leave alone: the scheduler, exit codes, other text.

Done when: both new regressions fail before and pass after; the existing run-slow and retry tests pass; lint and typecheck pass; affected results read with `squeal status --wait 60000 <paths>`.

Stop and report if either fix needs a scheduler change.
