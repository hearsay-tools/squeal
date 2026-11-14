# Wave 22.5: repair of `cand/0.1.490` (review `reviews/0.1.490.md`: FAIL)

Base: worker 344bc830's own branch (`cez/344bc830`); the coordinator cherry-picks the repair onto the candidate (`w22c/land`). Same check rules as `tasks/wave-22.md`.

## R1 (row 020-61, B1, B2, B3)

Use /worker. Shape: repair. Read `reviews/0.1.490.md` B1 to B3 with their reproductions.
- B1: the `--test` path is printed without shell quoting (`code-gate-text-left-out.ts:54`); a path with a space breaks the command. Quote it with the same `shellWord` the gate's other printed commands use.
- B2: an edited test file whose own functions did not change (a data-only edit) gets no `--test` advice, because the advice reads only changed function rows. Take the edited test files from the report's changed paths (`head.paths` or the changed set) that are among a left-out group's test files and did not run.
- B3: `scope.leftOut[].tests` is counted at selection, so a `--test` file whose `prepare` failed (it never ran) is counted as "ran". Make the field and its words say what it counts: the files `--test` named (selected for running), not the files that ran; the pre-run line then reads "named by --test". Whether each ran stays in `runs[]`. Update the D14.3 and D7 text in notes.
Owns: `src/cli/code-gate-text-left-out.ts`, `src/cli/code-gate-text.ts`, `src/cli/code-gate-prerun.ts` (the count words only), `src/core/code/gate/scope.ts`, their tests.
Done when (tests): each reproduction in the review passes: a spaced path round-trips through the shell to the right file; a data-only edited test gets its `--test` line; a `--test` file whose prepare failed is counted as named, and the words say named, not ran. Reports with no edited left-out file stay byte-identical.
