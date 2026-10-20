# Wave 6: performance after 0.1.226

0.1.226 (2026-10-20) shipped catch-up (011-22) and adoption (011-23). The performance push continues (the human, 2026-10-19: catch-up speed is the first priority; agents ignore a Squeal that lags).

## R1: 011-25, an agent's edit of a central source

Use /researcher. Shape: research. Read board row 011-25, spec 011 C4 (steps 3 to 5, catch-up as amended 2026-10-20 by 011-22, the four-tiers turn, claims), C10, `research/catch-up.md` (open question "Agent edits of central sources"), `reviews/wave-5.md` (how catch-up classifies a revision, `isCatchUp`, `Queue.toCatchUp`) and `tasks/011-22/notes.md`. Base: main at or after 8560795d (0.1.226).

Evidence (cezar, 0.1.224, `research/catch-up.md`): 62 revisions of 1 to 8 keyed sources re-keyed 200 to 472 test files each and ran them all as an edit's work, tiers of `runner.tierSize` one at a time without a permit; `packages/cezar/src/runs/store.ts` reaches about 220 test files; ba5234dc r13, a 6-source cherry-pick, took 1,454 s for 73 files. Closures are transitive, and the store keeps only closures, not the module graph.

Outcome: the rule that keeps an agent's own work fast when it edits a central source: which files stay on the edit route and which become catch-up (011-22's group, on the backlog's route), and the C4 sentences that say it.

Questions:
1. Direct importers. For cezar's 62 revisions, how many test files import each changed path directly versus transitively. Build the module graph at those revisions' heads (scratch clones by SHA; Vitest's own resolution or a static import scan, and say which and how far it can be trusted), and read the store read-only (`node:sqlite`, `readOnly: true`).
2. The cut. Candidates: (a) edited test files and the runner's direct importers stay edits, the transitive rest is catch-up; (b) a count of re-keyed files above which (a) applies; (c) a depth bound. Say for each where an agent's edit of one module and its own test file lands, and what a mistaken cut costs (a file the agent cares about waiting behind catch-up).
3. The runners. Whether Vitest's `affected` names direct importers today for every changed path, and whether node:test and pytest can: what each adapter returns now, and what it would take.
4. The gain on cezar: replay the 62 revisions under each cut from the store's recorded durations (as `probes/catch-up/` did): time to the edited module's own test file's result, time to all results, and the agent's next edit's wait.

Isolation and load: scratch clones by commit SHA, a scratch `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and store, never the real pool directory, a real session or a real store except read-only. No live measurement above a one-minute load of 8 on 24 CPUs; record the load beside every number; replays from recorded durations need no hold. Owns: `research/central-edits.md`, `research/probes/central-edits/`.

Done when: the findings file answers 1 to 4 and ends with a recommendation, the C4 sentences it would change, the question the human must decide, and the slice's done-when as tests.
