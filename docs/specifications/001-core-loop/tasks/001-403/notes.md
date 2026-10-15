# 001-403 notes: an abandoned checkpoint and an `unknown` test file name the file and why

## The gap

`Ledger.markUnknown` hands the sink a reason, and `sink.markUnknown` writes it as the summary of each **known check** of the file. A file that never stored a result has no known checks, so its reason was dropped. That is cezar's `artifacts/cli.test.ts`: it read a new path on every run, `rerunFirstSeen` stored nothing three times, and status could only count it ("Test files without checks: 0 pending, 1 unknown").

## What changed

- **Store.** A per-worktree `meta` row, `unknown-files:<worktreeId>` (registered in `WORKTREE_META_ROWS`, so worktree removal drops it). It holds one entry per file: the key it was marked at, the reason, `ran` (its run completed and stored nothing), up to 3 sample paths, the revision and the time. `src/core/scheduler/unknown-files.ts`. `Ledger.commit` writes the entries marked since the last commit in the same transaction as the sink's `markUnknown`. It keeps only entries whose file is still `unknown` at the key named, and at most 256.
- **Who sets `ran` and samples.** `rerunFirstSeen` passes the run's `firstSeen` paths. `discard` passes the inputs that moved during the run. `rerunGrown` (environment growth) passes the environment files. All three set `ran: true`. Crashes, timeouts, failed runner calls and the install wait keep `ran: false` with no samples.
- **Status.** `StatusSnapshot.unknownTestFiles?: { total, files }` (additive). It lists the files `readVerdict` counts `unknown`: no pending phase, and unkeyed, no checks, or an unknown check. They come in path order, the first 20. The reason comes from the `meta` entry when its key equals the row's key, else from an unknown check's summary, else `null`. The text block follows "Test files without checks", in the detail section, so the vision-ordered first lines are unchanged: `Test files without a result: N (nothing current at their inputs, none queued)`, then one line per file:
  - `<path>: ran, nothing recorded: 3 runs in a row read paths no earlier run had read (paths: a, b, c)`
  - `<path>: no result: timed out after 600 s`
  - `<path>: no result: no reason was kept`
- **`run --all --wait`.** The abandoned clause now lists "a test file's inputs never held still" among its causes. For an abandoned checkpoint, or any exit 3, the verdict line ends with `. Without a result: <the file's line>`. With several files it reads `…: N test files, listed below; the first: …`. The status block printed after it lists them all.

## Tests

- `test/scheduler/first-observation.test.ts`, "re-runs a file that reads a new path every run…". This is a real Vitest run of a file that reads `data/new-<now>.txt`. Status names it in both projects as "ran, nothing recorded" with the reason and `data/new-*.txt` sample paths. That is the done-when's "a file that reads a new path each run" and its "ran, nothing recorded" case, end to end through the ledger.
- `test/cli/run-all-verdict.test.ts`: an abandoned checkpoint with such a file names it on the verdict line and in the status block. The existing "unknown at the end" case now ends with the file and "no reason was kept".
- `test/status/unknown-files.test.ts` covers the listing rules: a recorded reason, the check-summary fallback, a stale-key entry ignored, pending and current files left out, and the cap.

## Open: the second missing file of cezar's checkpoint

That checkpoint stalled at 819 of 821. One gap was `artifacts/cli.test.ts`. The session never identified the second, and this worktree cannot read cezar's store, so it stays unidentified. With this change, the next abandoned checkpoint names every file without a result, and status names it afterwards. The likely candidates are a second reader of fresh paths (`absent-runs/<uuid>`), which would read "ran, nothing recorded", and a file that timed out alone, which would read "no result: timed out after N s". Run `squeal status` in that cezar worktree to settle it.

## For the next worker

- An entry written by a previous daemon survives a restart. A new daemon's ledger does not restore `unknownKey`, though, so its first commit with unknowns prunes the older entries. That is fine: an `unknown` file is work to do, and it re-runs.
- `src/core/scheduler/ledger.ts` (≈560 lines) and `tiers.ts` (≈530) were already over the ~300-line guide. The additions are kept small and the logic sits in `unknown-files.ts`.
