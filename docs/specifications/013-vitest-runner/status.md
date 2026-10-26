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
- 2026-10-20, 013-02 (worker 782141bb), deviation from `tasks/013-01/design.md` section 6 accepted by the coordinator: a test that rewrites a fixture it reads with `fs` is stored from its first run whether observation is on or off, not withheld by the barrier when observed, because the recorder never records a path the test itself wrote, so no key names it. V5's sentence on a path the run itself wrote holds for a file the run loads through Vite or a key names.
- 2026-10-21, 011-82 row B (the human accepted 011's design 011-82 as recommended; `../011-core/tasks/011-82/design.md` 2.6): V7 amended, one sentence. The related walk transforms only the test files Squeal lists, so an excluded test file's edits during a run withhold nothing (on squeal, 114 of 129 withheld files in 24 hours; the likely cause of a 167 s batch that stored none). Code row 011-95.
- 2026-10-21, 013-06 (the human chose the row; `reviews/0.1.250.md`: FAIL on B1, a separate project config's root server left whole, repaired by gathering before the close; PASS at c79623f16; landed in 0.1.250): V1 amended, **A closed instance is emptied**. Deviations from `tasks/013-06/brief.md`, accepted by the coordinator: a failed `#start` is not emptied (0.36 to 0.72 MiB per failed start, `tasks/013-06/notes.md` 4); the tests check that the closed instance is emptied and its module graphs collected, not that a `WeakRef` to it clears, because the plugins keep the empty shell reachable; the run's two graph reads moved before its failure branch's close. The key-format test passes with no adapter or format raise, through two validity cases by agreement (`closeRejected`, and `closeBroken` through the harness's `removeTempDir` flag).
- 2026-10-25, 011's coordinator, row 011-211: V1 cross-references 004 D2's new close of the slow instance.
- 2026-10-26, 011's coordinator, row 011-245 (gh-101): V8 and V10 amended. The forced cancel awaits `RunOptions.beforeForce` for at most 500 ms; the ties by which the daemon names a cut run's process still running are in V10, the note in 011 C13.
