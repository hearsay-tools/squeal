# Wave 13: dogfood follow-ups. Use /worker.

The human approved (2026-11-18) groups B, C and D of `lessons.md` ("What went wrong"). Read `lessons.md` (P3 to P9 with their evidence), `tasks/023-07-notes.md`, `023-08-notes.md`, `023-11-notes.md`, `023-18-notes.md`, and the spec D3, D4, D5. Skill, primer and hook texts are not in this wave (spec 005 ships them).

## Row 023-19: `status --at` reports and `--run` budget (P3, P4, P5, P6, P8)

- **P3, `--run` at its budget.** Every test file that completes before the budget ends is kept (stored when the checkout allows) and reported; the run stops at the budget, files not started read `not run (budget)` with the rerun line, and no completed result is lost to a kill. Before running a selection larger than a threshold derived from the machine and the stored durations (not a host-tuned number), print D17.1's estimate and how to narrow it (paths). The default budget, keying and install included, ends well inside a 600 s tool call: choose the default and state why in the notes.
- **P4, source paths.** `status --at <commit> <source path>` selects the test files whose closure at the commit holds that path, as `squeal status <path>` does; a path that selects nothing reads as `squeal status` says it.
- **P5, starting daemon.** While the daemon has not listed test files yet, the "now" side says so (or falls back to D3's store lookup at the working tree's keys), never "the daemon lists no such test file". Diagnose r1's node:test case (lessons P5) and fix it if it is a project-name mismatch.
- **P6, cold store.** Unknown files are grouped by reason with a count and a few paths each; the full list stays in `--json` and behind `--full`.
- **P8, new tests.** A selected file `absent` at the commit gets one line pointing at `squeal proof <file> --base <commit>`.
- Ownership: `src/cli/status-at*.ts`, `src/core/commit/at-keys*.ts`, `src/core/checkout/**` only for the budget; their tests. Not `src/cli/proof*`.

## Row 023-20: proof report and dependency control run (P7, P9)

- **P7.** A side not run says why: `green: not run (red passed: nothing to prove)` and the like for every not-run reason; never "not read" alone.
- **P9.** For `--case dependency`, and any proof with `--env` or `--without`, the red side also runs once without the conditions; the report adds one line, `red only under the conditions` or `red without them too` (then the verdict says the conditions are not shown to matter). That run is unconditioned, so it may be read from and written to the store like any side. Budget and `--repeat` rules apply to it.
- Ownership: `src/cli/proof*.ts`, `src/core/proof/**`; their tests. Not `src/cli/status-at*`.

## Both

- Regression test per item, failing on today's code. Lint, typecheck, check:private, key-format, boundaries; `squeal status --wait 60000` on changed paths; the by-hand end-to-end suite once at the end (`SQUEAL_E2E_AT=1`, command in `tasks/023-09-notes.md`), on the shared lab VM if this host is loaded (see the machine notes). Notes in `tasks/023-19-notes.md` / `023-20-notes.md`. No version raise, no build, no full suite; `timeout 600` on direct runs; nothing left running.
