# Wave 22 (the human, 2026-11-14: "Lost results: Save as it finishes", "Stored fail: Explain + flag", "#203: Fix the report", "#216 limit: Wait and see")

Three rows from main. 020-59 and 020-60 meet in `src/core/code/gate/collect.ts` and the gate's report types: 020-59 owns `collect.ts`; 020-60 owns `report.ts` and `types.ts` and asks before touching `collect.ts`. 020-61 is disjoint. Read the research files each row names and spec D3, D7, D11, D17. Targeted tests only (pin the host load with `test/code/gate/host-load.ts` in any gate test with a failing or estimated file), no full suite, no `pnpm run build` in a worker tree. A new `RunReport` field needs its rule in `src/core/daemon/report-merge.ts`. Notes in `tasks/wave-22-<row>/notes.md` with proposed spec text.

## 020-59: the gate saves each test file's result as soon as it finishes (#201, #202, #216)

Use /worker. Shape: slice. Read `research/issue-201.md`, `research/issue-202.md`, `research/issue-216.md` (the part about runs killed by a reboot), D17.3 and D17.5.
- Today the keeper writes every completed file after the report, with one 30 s bound (`KEEP_BUSY_BOUND_MS`, `keep-write.ts`); when another worktree's daemon holds the store past it, all of them are dropped (up to 1,596 files), the command waits after the report (#202), and a killed run keeps nothing (#216). Write each file's result while the run goes on, as soon as the file completes and every bar the keeper applies is decided for it (inputs stable since the lookup, runtime, merge hold, the rerun rule of 020-55). A busy store during the run never blocks the run: the write waits in a queue and is tried again; only what is still queued at the end waits the bound, and the stderr line says how many are left. A run killed after a file was written keeps it.
- Decide and write in notes which bars can only be judged at the end (if any) and how the early write stays as safe as today's; the store must never hold a result the run later invalidates.
Owns: `src/core/code/gate/{keep,keep-write,keep-here,keep-expected,keep-seen,keep-sent,collect,lanes}.ts`, `src/cli/code-gate.ts` (the end-of-run wait and its line), their tests.
Done when (tests): with the store held by another process for longer than the bound, files completed before the hold are kept and only the tail is not; a run killed mid-way keeps its written files and the next gate reads them `from: store`; a file whose input changes before the run ends is not kept (or is removed again, if the design writes first); the report still comes first and the command returns within the bound after it.

## 020-60: the gate says which failures came from the stores, and can rerun them (#200, #214)

Use /worker. Shape: slice. Read `research/issue-200.md`, `../011-core/research/issue-214.md` (the gate part only), D7, D11.2, D11.7 and row 020-53's `failedTests`.
- A failure read from the stores is reused and never rerun, and nothing says where it came from; `squeal retry` often cannot clear it (it refuses a failure another worktree stored). (a) Stderr names, after the verdict, each failed file read from the stores (bounded, three names per line), with the command that reruns them. (b) A new `squeal code` flag (name it in notes, for example `--rerun-stored-failures`) reruns once, inside the budget, every selected file whose evidence is a stored failure; the rerun's result is the file's and is kept as row 020-55 keeps a rerun. Without the flag nothing changes.
- First edit, as a lead: where `gate/stored.ts` hands a stored failed file to the evidence, mark it; then `retry.ts` takes those files when the flag is set.
Owns: `src/core/code/gate/{stored,retry,report,types,runs}.ts`, `src/cli/code-gate-args.ts`, the stderr line in `src/cli/code-gate.ts` (own commit; row 020-59 owns that file's end-of-run wait), `commands.md` text in notes, their tests.
Done when (tests): a stored failure prints its line and the rerun command; with the flag it reruns once and a pass reads passed and is kept; a second failure stays failed; without the flag reports are as before; stored passes are never rerun.

## 020-61: the left-out line names `--test <file>` (#203)

Use /worker. Shape: slice. Read `research/issue-203.md` and D14.
- The left-out line (`leftOutText`, `src/cli/code-gate-text.ts:211`) offers only `--group <name>`, which runs a whole group (about 100 browser specs in #203). Name `--test <file>` for the edited test files the scope left out, beside `--group`. After a `--test` run, the left-out count line reads "none of its 3 test files loads changed code" wrongly: fix the count to what was left out.
Owns: `src/cli/code-gate-text.ts`, `src/core/code/gate/scope.ts` only if the count needs it, their tests.
Done when (tests): an edited spec in a left-out group prints the `--test` command for it; after `--test` the count line is right; groups with no edited test file print as today.
