# 014 squeal ps: status

Stage: approved (the human, 2026-10-21)
Started: 2026-10-21

## Decisions so far

- 2026-10-21, the human: one command, `squeal ps`, that shows every live Squeal daemon and every test process Squeal started, each with its CPU and memory, and flags what should not be up, so the human can check what occupies the host. It prints one snapshot; a live view is out (a `--watch` can be a later row). It reports and changes nothing: each flagged line names the command that would end it. Beside Squeal's own processes it shows the host totals (load, CPU pressure, memory) and Squeal's share of them; it lists no other process.
- 2026-10-21, the coordinator's assumptions, for the spec to confirm or change: the default covers every daemon of the user on the host, grouped by repository with the current one first, and a flag narrows it to this repository; `--json` gives a versioned shape (styleguide); Linux through `/proc` first, macOS as far as research finds.
- 2026-10-21, the human, at the review of `spec.md`: approved as written; D9 yes, the daemon records its last use, as its own row; D10 adds a macOS fallback from `ps` that marks lock states unknown, untested on a Mac (the coordinator had recommended Linux only). The coordinator's assumptions stand as D1, D8 and D10.

## Open questions

None. The first run on a Mac is owed to `lessons.md` (D10).

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).

- 2026-10-21, 014-04 (worker 9f6ca37e), accepted by the coordinator: D8 amended. Added `memory` (`private` or `rss`), `orphans[]`, `daemon.permits`, `process.runId`, `escaped` and `flags`, the tier, checkpoint and descendants objects, and `unknown` as `[{ what, why }]`; `work.tier` and `work.checkpoint` became the arrays `work.tiers` and `work.checkpoints`, since a key holding a list is plural. The shipped keys are D8's block and `src/core/ps/shape.ts`.
- 2026-10-21, 014-04, accepted by the coordinator: D11 amended. The stage model and stage signatures live in `src/core/ps/model.ts`, so `shape.ts` holds only the D8 contract (465 lines in one file, over the styleguide's signal).
- 2026-10-21, `reviews/wave-0.md` blocker (reviewer 2c23e70e), coordinator repair on `cand/014-04`: D8 amended. `unflaggedFiles: [{ kind, count }] | null` carries D7's `--full` counts of the files that never get a flag, which no field could hold; `FlagFindings.unflagged` always counts them, and the snapshot keeps them with `--full` only.
- 2026-10-21, 014-06 (worker 622d50e7), accepted by the coordinator: D2 amended. A `starting` phase: a daemon holds its lock seconds before it registers, and the table read it as `stopping`. `DaemonWork.recordedStartedAt` (the start the row keeps) tells the two apart, by exclusion only; `PhaseOf` takes the snapshot's clock for D10's heartbeat rule, and `phaseOn(source)` reads the boot time and tick rate once. A SIGKILLed predecessor's unreplaced record reads `starting`.
- 2026-10-21, 014-06 and 014-07 (workers 622d50e7, b4db248c), decided by the coordinator: D3 and D5 amended. A tier's lane is `fast`, `slow` or `null`, the store's vocabulary, since the store names no runner per run; a test process's run is its mark's `#<runId>`, else the only open tier of its mark's lane class, else the one open tier without a lane, else `null`.
- 2026-10-21, 014-07, decided by the coordinator and applied at the wave 1 integration: D6 amended. `PsPlaces.userConfig` names the user-level config file, so the pool's slots follow `XDG_CONFIG_HOME`; 014-07 had read it through `HOME`.
- 2026-10-21, 014-08 (worker 05fb3bef), decided by the coordinator: D9 amended. `readDaemonUsed(value, startedAt)` reads `null` for a row older than the start the row records: the row is the worktree's, and a daemon of an older release writes none.
- 2026-10-21, `reviews/wave-1.md` B1 and B2 (reviewer 51b0c9a4), coordinator repair on `cand/0.1.238`, PASS on re-review (`reviews/wave-1-r2.md`, 2d4cd0dee): D3 amended. A predecessor's row gives a `starting` daemon no record, token, runs, checkpoints or last use; one start rule (`ownStartOn`) serves `phaseOn` and `readWork`. D5 unchanged: a pytest batch's files follow the last `--basetemp=`, Squeal's own, as the runner writes it (task 007-37).
- 2026-10-21, wave 1 (014-06, 014-07, 014-08) landed on main in 0.1.238 (d23e08066).
- 2026-10-21, 014-10 (worker ae84206e), decided by the coordinator: D8 amended. A file flag carries its `reason`, as a daemon's flag does: D7 gives every flag its reason, and the D8 text prints a stale file's date, which `render` reads from the shape alone. The shape change is one coordinator commit (`wip/014-w2-file-reason`, 89fd86f51) that 014-10 and 014-11 both take. 014-10's code splits into `flags.ts` (the `flag` export, daemon and process flags, the quoting) and `flags-files.ts` (the file flags, the unflagged counts, the leftover walk), for the styleguide's file length.
- 2026-10-21, wave 2 (014-10 ae84206e, 014-11 5231c98c, 014-12 300fddb7), the workers' open decisions accepted by the coordinator at integration: D1 amended (`--leftovers`, `--repo` and the error exits), D7 amended (the rules the table left open), D10 amended (the `uid=` column the coordinator asked for, the locale, the argument split). D8's example now shows `leftover-temp` as a counted flag, as D7's table makes it; on this host that makes `ps` exit 1 while leftovers exist (the human may reverse this). The text layout (columns, the `!` rows, `Unknown: N values; --full names each`) is 014-11's, within D8's contract that the layout is the worker's.
