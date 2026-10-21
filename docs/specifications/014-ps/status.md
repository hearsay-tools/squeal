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
