# Wave 25 (the human, 2026-11-14: "Text report: Build it"; "Setup helper: Later")

One row, from main. Targeted tests only, no full suite, no `pnpm run build` in a worker tree. Notes in `tasks/wave-25-020-63/notes.md` with proposed spec text (D1, D7).

## 020-63: the text report shows stored-failure reruns

Use /worker. Shape: slice. Read spec D1 (the text report), D3.4 and D7 (row 020-60: `runs[].storedRerun`, its stderr line), and `src/cli/code-gate-text.ts`.
- With `--rerun-stored-failures`, each rerun's outcome is in the JSON report (`runs[].storedRerun`) and on stderr, but the plain text report does not show it. Add it to the text report the way the report shows other per-file evidence: for each runner with stored reruns, one bounded line with each outcome's count (passed, failed, not finished) and at most three paths, so a reader of the text alone knows which failures were rerun and how they ended. Without the flag, or with no stored failure, the text is byte-identical to today.
- Do the same for the load reruns of row 020-54 (`runs[].retried`) if the text report does not show them yet; say in notes which it already shows.
Owns: `src/cli/code-gate-text.ts` (and a small new `code-gate-text-*.ts` file if the line needs one), their tests.
Done when (tests): a report with stored reruns prints the line with the right counts and paths; with no reruns the text is byte-identical; verdicts and exit codes unchanged.
