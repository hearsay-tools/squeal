# Wave 7 (row 023-07): `squeal status --at <commit> --run` — Use /worker.

Read `../spec.md` D1, D3, D4; `tasks/023-06-notes.md`, `023-16-notes.md`, `023-17-notes.md`, `023-04` notes (the gate as a library: `runGateFiles`, files-only, per-file outcomes, no child left) and `023-05-notes.md` (the checkout module).

Outcome: with `--run`, the files at the commit that read `no result` (or `not determined` only because no result exists) are run in the same temporary checkout the keying already made, their results written to the shared store at the commit's keys, and the comparison printed with them.

- One checkout per call: key, then run the missing files in that same checkout before it is removed (no second install). Selection: the files the diff `<commit>..HEAD` selects at the commit with no result at their key (020 D3.1); `--all-missing` runs every file with no result and prints 020 D17.1's estimate first.
- Budget: one `--timeout`, 600 s by default, the checkout and install included. Files not started read `not run (budget)`, with 020's rerun line. The JSON report gains the budget use.
- Environment: `TMPDIR` per run; `HOME` and every other variable as the daemon has them (D4.4). Results go to the shared store only through the gate's normal write at the commit's keys (020 D17.3); a file whose closure reads a path git does not hold reads `not comparable (needs <path>)` and is not run.
- A SIGKILL of the command leaves no process running and no checkout after the next sweep (D6).
- Starting seam: `src/cli/status-at*.ts` (remove the `--run` usage refusal) and `src/core/commit/at-keys*.ts` (a hook to run files inside the checkout before removal). Owns those, the help line, their tests. Leaves alone: `src/core/code/gate/**` beyond calling `runGateFiles`, `src/core/checkout/**` beyond calling it.
- Done when: real-adapter tests on `$TMPDIR` fixtures: a commit with one file missing a result runs it once, stores it, and a second `--at` call reads it from the store with no run; the budget cuts off and reports `not run (budget)`; `--all-missing` prints the estimate; a killed run is swept; lint, typecheck, check:private, key-format, boundaries; `squeal status --wait 60000` on changed paths. No version raise, no build, no full suite; `timeout 600`; no daemon, checkout or vitest left.
