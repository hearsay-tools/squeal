# Wave 19 (the human, 2026-11-13, on #210: "A: Explain it", "Retry once")

Two rows on disjoint seams, in parallel, from main. Read `research/issue-210.md` (probe, questions 1 to 5) and issue #210. Spec D5 (a selected failure blocks every function) stays as it is: no function state, verdict or `QUALITY_POLICY_VERSION` change. Check rules as in `tasks/wave-17.md`: targeted tests only, no full suite, no `pnpm run build` in a worker tree. Notes in `tasks/wave-19-<row>/notes.md` with proposed spec text.

## 020-53: a `test-failed` gap names the failed test and whether it loads the function

Use /worker. Shape: slice. Read spec D5, D7, D11.1 and D11.2.
- Each function with `gap: "test-failed"` names, in the JSON report, the failed tests behind it (file, test name, and where the evidence came from: run here, the stores or the parts) and, for each, whether that file loads the function (is among its loaders). The text report says it in one line per function group, bounded: "failed outside its loaders: <file> › <test>" when no failed file loads it. A real failure in one of its own loaders reads as today.
- First edit, as a lead: where `rule.ts:117` returns `"test-failed"`, carry the failed files that decided it, then split them by the function's loaders.
Owns: `src/core/code/gate/{rule,evaluate,types,report}.ts`, `src/cli/code-gate-text.ts`, their tests. Report fields in their own small commit; row 020-54 adds one field to `report.ts` and `types.ts` in its own commit (the coordinator resolves overlaps).
Done when (tests): #210's shape (a passing, fully covered callback beside an unrelated failing node:test file) reads `test-failed` with the failure named as outside its loaders; a failure in its own loader reads as its own; stored and parts failures name their origin; verdict, exit code and policy version unchanged.

## 020-54: the gate reruns once a failure recorded while the host was overloaded

Use /worker. Shape: slice. Read spec D11.2, D17 and 011's load retry (`src/core/retry/load.ts`, `src/core/scheduler/retries.ts` near 96, row 011-213).
- When a selected file fails here while the host load is above the daemon's load threshold (the same measure and threshold the daemon uses), the gate reruns that file once, inside the budget, after the other files. The rerun's result is the file's result; the report names the file as retried, with the load at the first failure, and stderr says so in one line. A failure that fails again stays failed. No retry for stored or parts failures, for a failure below the threshold, or past the budget.
- First edit, as a lead: in `collect.ts`, after the lanes end, take the failed files with their load sample and run them once more through the same lane.
Owns: `src/core/code/gate/{collect,lanes,runs}.ts`, a small new module beside them if needed, `src/cli/code-gate.ts` for the stderr line only, their tests; one field (`runs[].retried` or as you name it) in `report.ts` and `types.ts` in its own commit.
Done when (tests): a failure above the threshold that passes on rerun reads passed and named retried; one that fails again stays failed; below the threshold no rerun; no rerun past the budget or for stored and parts evidence; the load sample uses the daemon's own threshold function.
