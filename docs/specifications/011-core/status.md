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
