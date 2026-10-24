# Wave 1b of spec 015: fixes from the live dogfood

Four rows in parallel on disjoint seams, from `lessons.md` "Round 1, live sessions (015-10)". Each reproduction is a session there. 015-21 waits for the human's choice. One candidate and one review (015-24). Briefed by coordinator 52e58f23 on 2026-10-24.

All rows: read `spec.md` D2 to D7, `lessons.md` "Round 1, live sessions", and the notes under `tasks/015-04/` to `tasks/015-08/`, `tasks/015-16/` and `tasks/015-17/`. Test first. Not yours: the board, spec text, bundles (`plugins/*/dist`), the version, and another row's files. No `npm run build`. Final message: the decisions the brief did not settle, any type change, and the output of lint, typecheck and `squeal run --all --wait`.

## W1: 015-19, a pull is not the agent's edit

Use /worker. Shape: repair. Outcome: a revision that moves `HEAD` (pull, merge, rebase, checkout) marks no first edit for a file whose working-tree blob equals its blob at the new `HEAD`. `FAIL` and `PASS` from that revision are still told. Reproduction: sq6 and `tasks/015-10/window.md`.
- **Seam.** Where the pass builds `PassReport.edited` (`src/core/code/pass/`). Find how a revision knows `HEAD` moved, from `src/core/revision/`; use it read-only.
- **Owns.** `src/core/code/pass/**`, `test/code/pass/**`.
- **Done when.** A pass test: a revision that moves `HEAD` and brings a failing function's committed body tells no `STILL FAIL`. A later working-tree edit to it still tells one.

## W2: 015-20, seeding after catch-up and views only for failing functions

Use /worker. Shape: repair. Outcome: P2 and P5 of `lessons.md`, and its two wording points.
- **Seeding.** A registration made before the pass reaches the latest revision is seeded again, by count only, once the pass reaches it. Reproduction: sq2.
- **Views.** Seed and keep view rows only for failing functions; a missing row reads `pass`. Drop a consumer's code views at SessionEnd and with C7's departed consumers. Reproduction: cz6.
- **Wording.** The first-count status line has no "0 functions over" while counting (D6 gives `Complexity: counting, 340 of 600 files.`). A delivery title counts no `STILL FAIL` as a change and leaves no code line out.
- **Owns.** `src/core/delivery/code-*.ts`, `src/core/delivery/format.ts`, `src/core/code/store/{views,states,schema,types}.ts`, `src/core/status/code-status.ts`, and the SessionEnd path in `src/harness/shared/`. Tests: `test/code/delivery/**` except W3's new file, plus store tests.
- **Done when.**
  - An integration test: stop the daemon, take a function from 20 to 21, start a session and edit another file. The session gets no `FAIL` for it, and its count equals `squeal code`.
  - On a store with 20,000 functions, a PostToolBatch with one code transition stays under 0.3 s.
  - After SessionEnd the consumer has no view rows.
  - A registration writes one row per failing function.

## W3: 015-22, `squeal code` marks a count that is behind the file

Use /worker. Shape: repair. Outcome: `squeal code <path>` compares each file's bytes with its counted blob. When they differ, it waits up to 750 ms for the pass, then prints `pending: changed since revision N, not counted yet` instead of the old counts. The JSON gets the same field. Reproduction: sq2 and cz2.
- **Owns.** `src/cli/code.ts`, `src/cli/code-report.ts`, a new `test/code/delivery/code-pending.test.ts`. Read the code store; do not change it.
- **Done when.** A CLI test: edit a counted file with no pass, and `squeal code <path>` prints the file as pending, in text and JSON.

## W4: 015-23, two parse errors that need not be

Use /worker. Shape: repair. Outcome: `export type * from` parses, and a raw NUL byte in a string no longer stops a function from being judged. Reproduction: `lessons.md` "Other observations", parse errors.
- **Seam.** Update `tree-sitter-tsx.wasm` in `src/core/code/count/` from a `tree-sitter-typescript` release that parses `export type *`, if one exists; otherwise say so, and handle it in the error rule. Replace each NUL with a space before parsing, so offsets stay the same. Raise `COUNTER_VERSION`.
- **Owns.** `src/core/code/count/**`, `test/code/count/**`, `test/fixtures/code/**`.
- **Done when.**
  - A fixture with `export type * from "./x.js"` and a string holding a NUL parses.
  - The function after the NUL is counted.
  - The pinned ESLint and radon comparisons still pass.

## W5: 015-21, a failed fix attempt hears once more

Use /worker. Shape: repair. Starts from `int/015b` with W1 to W4 integrated. The human chose this on 2026-10-24 (`status.md`). Outcome: after a `FAIL` told in this session, the next edit that changes the function's body and leaves it over tells one `STILL FAIL`. Later edits that stay over are quiet until its state changes. Reproduction: sq3 in `lessons.md`.
- **Wording.** Every `STILL FAIL` line, this one and the first edit to a standing failure (015-08), ends with a hint that Squeal stays quiet about the function until it is back at or under the threshold, and that `squeal code <path>` shows its count at any time. For example: `STILL FAIL complexity: retryCommand (src/cli/retry.ts:69) is 22 after the edit, over 20 (ESLint rule); Squeal stays quiet about it until it is at or under 20, and squeal code src/cli/retry.ts shows its count.` Keep it to one line. Put the same rule in the skill's `references/policy.md` (claude-code, codex, pi).
- **Seam.** `tellCode`'s plan in `src/core/delivery/code-*.ts` and the view's told marks (015-08 and 015-20 notes). A `FAIL` told in full, then an edit after it (`edited_at` after the entry's `toldAt`) with the state still `fail`, tells once and marks the entry so the next edit is quiet.
- **Owns.** `src/core/delivery/code-*.ts`, `src/core/code/store/{views,types,schema}.ts` if a mark needs a column, `plugins/{claude-code,codex,pi}/skills/squeal/references/policy.md`, `test/code/delivery/**`.
- **Done when.**
  - `FAIL` at 23, an edit to 22: one `STILL FAIL ... is 22` with the hint.
  - An edit to 21: quiet. An edit to 20: `PASS`.
  - A standing failure's first-edit `STILL FAIL` carries the hint.
  - Another session is not affected.
  - Lint, typecheck and `squeal run --all --wait` pass; paste their output.
