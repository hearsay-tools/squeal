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

## W1: 011-31, a step-down cancels its tiers in flight

Use /worker. Shape: code. Read board row 011-31, `tasks/011-30/design.md` sections 1 and 5 (R1) and its "Spec text", spec 011 C9 and C4 step 5 as amended 2026-10-20, `research/issue-47.md` (runs 2 and 4). Base: main at ec6337e6 (0.1.226 released).

Do R1 as the design states: `onStepDown` in `src/core/daemon/daemon.ts` cancels its tiers in flight (`#cancelTiers()`) before its shutdown, as `onStop` does; `stepDownIfOlder` in `src/harness/shared/ensure.ts` sends `stop` after an accepted step-down, within C8's two round trips. Every lane's tier and every backlog slot is cancelled; files whose module ended keep their results, the rest are queued uncounted, forced ones still forced, one `superseded` note.

Tests first, red before: `test/daemon/step-down.test.ts`'s `stepsDownAfterItsTier` (0.1.0 case) becomes the cancel (old daemon out within 15 s while the file would run 60 s, its row `queued`, one note); the released 0.1.31 case stays (before 0.1.200 the tier finishes). A step-down with a Vitest tier and a node:test tier in flight cancels both and leaves no marked process (shape of `test/daemon/stop-cancel.test.ts`). `test/harness/step-down.test.ts` checks the `stop` after an accepted step-down and the budget test still holds.

Not yours: 011-32 (the handoff claim), 011-33, 011-34; `src/core/scheduler/` beyond what the cancel already uses. No version bump and no `KEY_FORMAT_VERSION` change or re-pin: this row ships in the 001 coordinator's bundle under format 18, so `test/keys/key-format.test.ts` and the bundle-drift tests failing on your guarded change are expected; say so in your summary. Done when: the tests above pass, lint and typecheck are clean, `squeal run --all --wait` is pasted, and `tasks/011-31/notes.md` names the seams, the tests and anything the design did not foresee.

## W2: 011-33, a restart hands the queued work over

Use /worker. Shape: code. Read board row 011-33, `tasks/011-30/design.md` sections 3 and 5 (R3), spec 011 C4 (the "Explicit checkpoints" paragraph as amended 2026-10-20, row 011-30, Q3 (a) and Q5 (a)), `reviews/wave-5.md` (B3: the baseline classifies each unrefined revision on its own, `UnseenChanges` in `bootstrap.ts`). Base: main at ec6337e6.

Do R3 as the design states: whatever `baseline.onStart` says, the start baseline queues every file whose row its predecessor left `queued` or `running`, at this daemon's key, unless the lookup finds a result there; ordered by step 4 as of the revisions whose re-key moves are still open for it (edited file or direct importer first group, environment-only second, a catch-up revision's catch-up, else second); a pending re-run of a new failure is queued too (`restoreReruns`, Q5 (a)). Cold-start misses stay as the policy leaves them. The handed-over files go through the same lookup as every miss (`Ledger.settle`/lookup), so when 011-38 lands (formats 13 on read as one, the 001 coordinator's worker 09725721, owning `keying.ts`, `ledger.ts`, `stored-keys.ts`) a row readable at an older format settles without a run: do not add a second lookup path, and do not edit 011-38's files beyond a call site.

Tests first, red before: the design's scheduler test over a seeded store under `lookup-only` (four cases: an open edit move's queued row in the first group and runs; an environment-only re-key's row in the second; under a key-format change the queued file queued at its new key and the rest stale; under the default baseline the handed-over edit's file before the baseline's misses), and the daemon test of run 5's shape (same version, `lookup-only`, `stop` with the tier held, `start`, `status --wait 60000 tests/hold.test.ts` holds until the file's result; red today: quiet in 0.5 s).

Not yours: 011-31, 011-32, 011-34. No version bump and no `KEY_FORMAT_VERSION` change or re-pin (as W1). Done when: the tests above pass, lint and typecheck are clean, `squeal run --all --wait` is pasted, and `tasks/011-33/notes.md` names the seams, the tests and the interplay with 011-38.
