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
