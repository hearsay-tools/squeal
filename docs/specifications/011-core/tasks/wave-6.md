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

## R2: 011-25, which tests stay an edit's work: the edit cut measured

Use /researcher. Shape: research. Read board row 011-25, `research/central-edits.md` (its probes in `research/probes/central-edits/`, which you reuse), spec 011 C4 step 4 and C15 (a named wait promotes a file to the first group). Base: main at or after 84509d92.

The human (2026-10-20), on `central-edits.md`'s question "cap the direct importers kept as edits?": measure first. Their proposal: only the test that targets the changed file (its namesake, `store.ts` to `store.test.ts`) stays an edit's work, and every other importer, direct or not, is catch-up. Their concern, which the answer must meet: a rule based on names alone fails in a repository whose tests do not mirror its file names, and there every edit would go to catch-up, losing the edit route that exists for a reason. They also ask whether 150 to 182 test files importing `runs/store.ts` directly is a smell in the project.

Questions:
1. Namesakes. Define the candidate matches (same stem with `.test`/`.spec`, a `__tests__` sibling, a mirrored `test/` tree, pytest `test_<stem>.py` and `<stem>_test.py`) and, for every changed source of cezar's 62 central revisions and 293 agent revisions, how often each finds exactly one, several or none. Do the same on a repository with a separate test tree: this one (Squeal's `src/` against `test/`, its store `.git/squeal/store.sqlite` read only, `node:sqlite` `readOnly: true`, a copy first), and any pytest or node:test repository on the host that has a Squeal store; say which you found.
2. Cuts, replayed as `central-edits.md` did: (a) edited and added test files plus all direct importers; (n) edited and added test files plus each changed source's namesakes, and for a changed source with no namesake its direct importers, so no repository loses the edit route; (n+K) (n) plus the K shortest direct importers. For each: the own test file's time to a result, the next edit's wait (median, p90), all results' time, on cezar and on Squeal's history.
3. Exposure. From the recorded results (`results` with `outcome` fail, by revision), for each revision whose re-keyed files failed: was the first failing file an edited test, a namesake, another direct importer, or transitive; and under each cut how much later its first failure reports. This is the number the human decides on.
4. The smell. Classify `runs/store.ts`'s direct importers (and the next two hubs') by how they use it: the subject under test, a fixture or setup (constructing a store to test something else), a type only, or a testkit. Say whether the count reflects a design problem in cezar or ordinary test setup, and what a testkit-style indirection would change under each cut.

Isolation and load: as R1 (scratch clones by SHA, scratch `HOME` and XDG dirs, stores read only from a copy, no live measurement). Owns: `research/edit-cut.md`, `research/probes/edit-cut/`.

Done when: the findings file answers 1 to 4, ends with a recommendation that names what happens in a repository with no naming convention, the C4 sentences it would change, and the slice's done-when as tests (replacing or extending `central-edits.md`'s 1 to 10).

## W3: 011-25, an edit keeps its namesakes and the shortest direct importers; the rest is catch-up

Use /worker. Shape: code. Read board row 011-25, spec 011 C4 step 4 and "Explicit checkpoints" as amended 2026-10-20 for 011-25 (the human chose cut (n+K)), `research/edit-cut.md` (its recommendation, the namesake definition and the slice's done-when 1 to 11) and `research/central-edits.md` (the three seams: `applyRunnerPart` demotes through `Queue.toCatchUp(ref, keyedAt)`, today's rule when `affected` fails or is abandoned, a start calls `affected` per unrefined revision), `reviews/wave-5.md` (how catch-up classifies a revision; `Entry.recentBy`). Base: main at or after this brief's commit.

Do the C4 rule: a revision of fewer than 10 keyed paths keeps as an edit's work its added and edited test files, each changed source's namesakes among the files it re-keyed (or, when a source has none, the runner's direct importers of it), and the `runner.tierSize` shortest other direct importers by last-known duration; every other file it re-keys is catch-up. No runner adapter changes (`affected` already splits direct and transitive). The namesake matcher is one pure function with its own tests, so row 011-43 can later make its patterns configurable.

Tests first, red before: `edit-cut.md`'s done-when 1 to 10 in `test/scheduler/` (the `catch-up-fixture.ts` shape, a fake runner whose `affected` returns a direct and transitive split); 011-22's catch-up and wave-5 classification tests stay green. Done-when 11 (the cezar replay) is optional here and noted in your notes if skipped.

Release: the scheduler sources are guarded, so this row raises the key format. Do not bump the version or re-pin; the coordinators bundle it into the next guarded release (011 `status.md`, 011-37: guarded rows ship together until 011-41). Expected failures: `key-format.test.ts` and the bundle-drift tests; say so. Not yours: 011-38's files beyond a call site (`keying.ts`, `ledger.ts`, `stored-keys.ts` changed in the format-18 bundle; rebase onto main if it has landed). Done when: the tests pass, lint and typecheck are clean, `squeal run --all --wait` is pasted, and `tasks/011-25/notes.md` names the seams, the tests and any namesake case the research did not cover.

## R3: review of cand/0.1.229, 011-25's edit cut

Use /reviewer. Shape: review. Pinned to the `cand/0.1.229` SHA named in the spawn; the range is `origin/main..<sha>`: W3's commits (the namesake matcher, the cut, the start's cut, the notes), the coordinator's `revision-lag.test.ts` adaptation, the release commit (version 0.1.229, `KEY_FORMAT_VERSION` 19 re-pinned, format 18 read as one, the bundles) and this brief. W3 was written on 0.1.226's base and rebased onto 0.1.228, where 011-33's handover meets the start's cut in `bootstrap.ts`.

Read W3 above, spec 011 C4 step 4 and "Explicit checkpoints" as amended 2026-10-20 for 011-25, `research/edit-cut.md` (the namesake definition, the recommendation, done-when 1 to 11), `research/central-edits.md` (the three seams), `reviews/wave-5.md` (`Entry.recentBy`) and `tasks/011-25/notes.md`. Check that:
- a revision of fewer than 10 keyed paths keeps as an edit's work exactly its added and edited test files, each changed source's namesakes among the files it re-keyed, the runner's direct importers of a changed source with no namesake, and the `runner.tierSize` shortest other direct importers; everything else it re-keys is catch-up, and a revision of 10 or more is catch-up as before;
- the demotion goes through `Queue.toCatchUp(ref, revision)`, so a file an earlier revision kept recent stays recent; when `affected` fails or is abandoned, today's rule holds; a named wait still promotes a demoted file;
- `namesakesOf` is one pure function, matches the patterns `edit-cut.md` defines and nothing looser, and a repository with no naming convention keeps an edit route through the direct-importer fallback;
- a daemon start cuts each unrefined small revision on its own, never their union, and never under `lookup-only`; in `bootstrap.ts` the cut composes with 011-33's handover: the predecessor's queued or running rows are queued whatever `onStart` says, and a handed-over file keeps the group the handover gave it;
- the `revision-lag.test.ts` change keeps the property that test was written for (an in-flight edit tier is not starved by a later revision);
- `KEY_FORMAT_VERSION` 19 is right against the released 18 (0.1.228), format 18 joins `KEY_FORMATS_READ_AS_ONE` rightly (011-25 changes no stored result's meaning), and the bundles match the tree.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; a file that fails loaded and passes alone is named. Write `reviews/wave-6.md` with a PASS or FAIL verdict and commit it.
