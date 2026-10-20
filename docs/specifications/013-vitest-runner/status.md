# 013 Vitest runner adapter: status

Stage: shipped (inherited from 001, shipped 2026-10-06)
Started: 2026-10-17, forked from `../001-core-loop/spec.md` at `cdd72a91` by the split proposal (`../001-core-loop/split-proposal.md`, section 6)

## Decisions so far

- 001's decisions through 0.1.203 stand; they are in `../001-core-loop/status.md` (frozen) with the amendment lines that made them. The crosswalk at the end of `spec.md` maps every 001 section to its section here.
- The split proposal's decisions by the human (Q1 to Q8, 2026-10-16 and 2026-10-17) bind this spec: see its sections 9 and 11.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).

- 2026-10-17: forked from 001 at `cdd72a91`. 001's text lifted verbatim (tagged paragraphs); the notes and the sections 001 did not have are new and change no rule.
- 2026-10-17, 011-06: V5 amended. The adapter reports a touched run's completed files as `RunReport.withheld`; the scheduler re-queues them (011 C4) instead of recording them `unknown`, and a file that rewrites its own bytes every run ends `unknown` at the discard limit.
- 2026-10-20, 013-01 design accepted (the human, `tasks/013-01/design.md`: D1 the narrowed touch rule, a touch counts for an instance only when the instance could have read the path and withholds only the test files that reach it; D2 the completion barrier narrowed to the files whose keys name the touched path, in its own commit; D3 `tsconfig*.json`, `jsconfig*.json` and `.env*` count as read-once inputs by name): V5's Touched files bullet amended, with 011 C2's barrier sentence. Code row 013-02.
