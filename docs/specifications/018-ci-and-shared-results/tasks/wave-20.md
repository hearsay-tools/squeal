# Wave 20: inputs nothing touched

The human, 2026-11-20: "Spec D30-34: Approve". Spec 018 fourth slice, D30 to D34. Evidence: `research/unread-inputs.md` (row 018-56) and its probes `research/probes/unread-inputs/` (the six fixtures and the replay scripts). 018-58 starts from 018-57's part format commit. One candidate, one review, one release.

Every row: test first; `squeal status --wait 60000 <changed-path>...` before finishing; no full suite; no `pnpm run build` in a worker tree; any direct vitest run gets `timeout 600`. `KEY_FORMAT_VERSION` and the adapter versions do not move. Final message: commits, the tests that prove each part, decisions the spec did not settle, type changes.

## 018-57 `ci record` writes endpoint hashes and touched paths (part format 6)

Shape: slice. Spec D30, D31, D32. Starting seam: `src/core/ci/parts.ts` (format 6: `stable`, `touched`). Make that change first, as its own commit, then send the coordinator its SHA. Next, `readRecorded` in `src/core/ci/inputs.ts` returns touched paths instead of dropping them (D31). Then the endpoint hashes in `ci record`'s own process, before and after the command, through `hereOf` (D30), wired in `src/cli/ci.ts` and `src/cli/ci-parts.ts` for both runners. Owns those files, `src/runners/ci-runtime/`, `src/runners/*/ci-record.ts` and their tests. Leaves alone: `src/core/ci/reuse.ts`, `src/core/ci/export*.ts`, `src/cli/ci-export.ts` (018-58's). Done when the record tests of the spec's Testing section pass, as listed below:
- parts carry `stable` (only paths that differ from the commit) and `touched`;
- a withheld child gives `"all"`;
- the cost line includes the hashing;
- format 5 parts still read.
Also measure the listing hashes' cost and a format 6 part's size on a fixture shaped like cezar's shard (open question 1). Use /worker.

## 018-58 `ci export` certifies inputs nothing touched

Shape: slice. Spec D33, D34, D8. Baseline: 018-57's part format commit. Starting seam: `FileReuse.evidence` in `src/core/ci/reuse.ts`, the one owner for `ci export` and the gate's `--parts`. The new rule applies only to an input with no read-time evidence. The input must be untouched, stable, present, not ignored, and equal here. Count the files certified this way in the export report (`src/core/ci/export-report.ts`). Amend D8's condition text in `ci record --help`. That text is 018-57's file `src/cli/ci.ts`: send the coordinator the wording, and the coordinator relays it. Owns `src/core/ci/reuse.ts`, `src/core/ci/export*.ts`, `src/cli/ci-export.ts` and their tests. Done when:
- the six fixtures of `unread-inputs.md` 1 give the outcomes in the spec's Testing section;
- the D34 wrong pass is pinned as the documented residual;
- absent and ignored inputs are never certified by the rule;
- a format 5 part exports exactly as today;
- a replay of cezar run 44808547913's artifacts with the candidate's export exports at least 98% of files. The artifacts are kept until 2026-11-23. Use `research/probes/unread-inputs/` scripts, a clone under your `$TMPDIR`, and no daemon in another checkout.

Use /worker.

## 018-59 repair of reviews 0.1.582 and 0.1.582-r2: one owner for path-keyed maps, and an end-to-end guard

The human, 2026-11-21: "0.1.582: A: guard + 3rd review". Shape: repair, on the candidate. Both reviews (`reviews/0.1.582.md` B1, `reviews/0.1.582-r2.md` B2) found a map keyed by path built by assignment into a plain object. A file named `__proto__` then lost its entry, and the D33 rule certified it: a wrong pass. Both places are fixed on this branch: `src/core/ci/endpoints.ts` (`Object.fromEntries`) and `src/runners/ci-runtime/evidence.cjs` (`Object.create(null)`, commit "read evidence stays own").
1. **One owner.** Every map keyed by path or name in the CI record, part and export code is built through one helper. That code is `src/core/ci/`, `src/runners/ci-runtime/`, `src/runners/*/ci-runtime/`, `src/runners/*/ci-*.ts` and `src/cli/ci*.ts`. The `.cjs` runtime may need its own copy, kept equal by a test. Map the code for any other assignment-built map first, `children.cjs` and the env maps included, and list each one in your notes.
2. **An end-to-end guard.** One test runs `ci record` and `ci export` through both runners on tracked files named `__proto__`, `constructor`, `toString` and `hasOwnProperty`. It covers each of these:
   - read by Node;
   - read by a shell only;
   - changed before the step;
   - changed and restored by a shell during the step (the r2 case).

   It asserts the right outcome per case, as in the spec's Testing section. It must fail on the parent of each of the two fixes.
3. Owns the files above and their tests. Keys, adapter versions and part format do not move.

Use /worker.
