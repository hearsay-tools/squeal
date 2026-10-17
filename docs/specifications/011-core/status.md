# 011 Core: status

Stage: shipped (inherited from 001, shipped 2026-10-06)
Started: 2026-10-17, forked from `../001-core-loop/spec.md` at `cdd72a91` by the split proposal (`../001-core-loop/split-proposal.md`, section 6)

## Decisions so far

- 001's decisions through 0.1.203 stand; they are in `../001-core-loop/status.md` (frozen) with the amendment lines that made them. The crosswalk at the end of `spec.md` maps every 001 section to its section here.
- The split proposal's decisions by the human (Q1 to Q8, 2026-10-16 and 2026-10-17) bind this spec: see its sections 9 and 11.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).

- 2026-10-17: forked from 001 at `cdd72a91`. 001's text lifted verbatim (tagged paragraphs); the notes and the sections 001 did not have are new and change no rule.
- 2026-10-17, 011-01 (review `reviews/wave-1.md` B1): the row's "on exhaustion name `squeal status --wait`" is dropped. That wait ends at its first unavailable read, so naming it promised a wait that would stop at the same lock. The message says how long the read waited, that another process holds the store's lock, and to run the command again once it is released. S1: an attempt's busy timeout is capped by what is left of `CLI_READ_RETRY_MS`.
- 2026-10-17, 011-06 (issue #10, 001-364; review `reviews/wave-1.6.md` follow-up): C4 amended twice. A run the runner withheld for a touch is re-queued as a stability discard and counted toward the discard limit, never stored; an add or a delete cancels a backlog tier only through its runner part, once an edit's work is queued in the tier's lane. C14: `RunReport.withheld`, additive.
- 2026-10-17, 011-10 (issue #26) and 011-09 (issue #25), 0.1.208: C6 amended. A wait prints the snapshot first and its verdict line last, which now also carries the worktree's known failures and its checks running and queued. 011-10's worker edited the three skill copies under the coordinator's grant. C9 gains `squeal stop <root>`'s resolution. One case the row left open was decided by the coordinator: an existing path inside a worktree that is not its top level exits 1 and stops nothing. A removed worker's leftover directory is that case, and stopping its enclosing checkout was the bug. `squeal stop some/subdir` no longer works; the usage line already reads `[root]`.
