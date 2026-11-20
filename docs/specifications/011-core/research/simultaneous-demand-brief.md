# Brief: row 011-420, a daemon in its catch-up quiet claims its fair share

Use /researcher. Approved by the human on 2026-11-20 (card of coordinator 4abb5168: "Research now"). Research only.

**Question.** `research/run-width-design.md` cause (3): when two worktrees are edited at once, both wait out the catch-up quiet, the first to start takes the whole background ceiling (the other has published no demand: `#share` counts marks with `want > 0`), and the second's first tier runs narrow for 99 to 195 s. Would publishing the queued backlog's demand during the quiet (or holding the first grant to its fair share while another daemon's quiet holds backlog) end those narrow tiers, and at what cost to a single worktree?

**Method.** Read `src/core/capacity/{pool,share,marks}.ts`, `src/core/scheduler/quiet.ts`, spec 011 C10, spec 021 D18. Prototype one or two VM-only patches on top of main (which has row 011-417's fresh readings; rows 011-418 and 011-419 may land meanwhile: say which you measured). Measure the 011-400 S2 two-daemon shape (290 files per copy, both edited at once) against main, and one single-daemon H0 run per arm, at least two runs each (three if the spread allows). Lab VM only: check its load is under 1 and no other task runs before each timed run, work in `~/work/<id8>`, remove it when done; tell me when you start and end there.

**Done when.** `research/simultaneous-demand.md`: per arm the longest narrow tier, wall time, CPU and samples above the ceiling, with tagged evidence and run counts, a recommended rule with its spec text, and the risks for one worktree.
