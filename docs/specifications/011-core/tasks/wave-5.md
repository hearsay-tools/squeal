# 011 wave 5 (2026-10-20)

Rows 011-22, then 011-23, in the human's order (2026-10-19 and 2026-10-20: performance first; agents already ignore Squeal because it takes too long to catch up). Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, `package.json` versions and `plugins/*/dist` to the coordinator.

## R3: 011-22 and 011-23, catching up after a pull or a daemon start

Use /researcher. Shape: research. Read board rows 011-22 and 011-23, spec 011 C4 (steps 3 to 5 as amended for slots 2026-10-19, the four-tiers backlog turn, claims), C5 (provenance, an inherited fail's confirmation), C10 Capacity, `baseline.onStart` (C12's policy list), `research/backlog-wall-budget.md`, `research/streaming-lanes.md` and `tasks/011-21/notes.md`. Base: `cand/0.1.225` once it lands, main until then; slots for node:test and pytest are part of the design you start from.

Evidence (cezar, 0.1.224, 2026-10-19, in rows 011-22 and 011-23): a daemon start after about 7 h saw 152 changed sources in one sync revision; 733 re-keyed test files became an edit's work and ran in tiers of 4, one at a time, without a permit (4 files in 2 minutes, load 14 on 24 CPUs, 44 % idle); `run --all` on the same files ran tiers of 200 at a grant of 24 and passed 610 in about 2.5 minutes. A second worktree on the same commit inherited 3,240 results once, then stayed at 747 stale files while main stored passes at the same keys.

Outcome: the rule that puts a pull's or a daemon start's re-keyed files ahead of the rest of the backlog without the edit route (the human: they keep priority, they leave the edit route), and the rule by which a stale file adopts a result another live worktree stored at its key.

Questions:
1. What marks the work. Weigh the revision's size (files re-keyed, sources changed), its trigger (the start's sync, a reconciliation `interval`, a HEAD move), and whether files that import a changed path directly stay an edit's work. An agent editing 30 files by hand, a `git pull` of 150, and a branch switch should each land where an agent expects. Name the threshold from cezar's revision history in its store (read only, `node:sqlite` with `readOnly: true`), not a guess.
2. Where it runs. A third group between C4 step 4's first and second, or the first group at backlog width: its tier size, the pool grant, the 120 s wall, node:test and pytest slots, the cancel by a later edit, the four-tiers turn, claims between worktrees on one commit, and the slow tier's wait.
3. Adoption. When a daemon stores results, how other live daemons with files stale at those keys learn it (the store, the socket, the next reconciliation), what it costs per commit on cezar's store size, and that provenance and C5's confirmation of an inherited fail hold. Whether `lookup-only` should also re-look-up stale keys on a timer, and what that costs.
4. The gain on cezar: replay the 733-file case and the second worktree under each rule from the store's recorded durations.

Isolation and load: as R1 in `tasks/wave-3.md`: scratch clones by commit SHA, a scratch `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and store, never the real pool directory, a real session or a real store except read-only. Hold live measurements while the one-minute load is above 8 on 24 and record the load beside every number; replays from recorded durations need no hold. Owns: `research/catch-up.md`, `research/probes/catch-up/`.

Done when: the findings file answers 1 to 4 and ends with a recommendation for each row, the C4 sentences it would change, and each slice's done-when as tests.

## W1: 011-22, a revision of 10 or more keyed sources runs as catch-up on the backlog's route

Use /worker. Shape: slice. Read board row 011-22, spec 011 C4 steps 4 and 5 as amended 2026-10-20 (`status.md`), `research/catch-up.md` (findings 1, 2 and 4, the Recommendation and 011-22's done-when), and `tasks/011-21/notes.md` (slots, `busyLanes`, the backlog turn). Base: `cand/0.1.225` (slots), rebased onto main once it lands.

Outcome: a revision that changes 10 or more keyed paths puts the files it re-keys in a catch-up group between the first and the second, on the backlog's route (pool grant, 120 s wall, slots for node:test and pytest), failing first then shortest first, cancelled by a later edit in a Vitest lane and run beside in a node:test or pytest lane; the four-tiers turn takes catch-up first.

Seams: `RunQueue` (`src/core/scheduler/queue.ts`: the groups, `ordered`, `hasFirstGroup`, `tierSelected`, `backlogTurn`), where a revision's re-key enqueues its files (`revision.ts`, `batch.ts`, `head-move.ts`, `bootstrap.ts`; the count of keyed paths a revision changed), `selectTier`'s `backlog` test (`tiers.ts`), and the cancel of a backlog tier (`Scheduler.handleBatch`). Raise `KEY_FORMAT_VERSION` to 17 only if a guarded source changes, and pin the printed hash.

Owns: those files, their tests, new tests under `test/scheduler/`. Write `tasks/011-22/notes.md`. Leave the board, `status.md`, `spec.md`, versions and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output; do not run `npm run build`. `run-reads-fidelity` and `observe-fidelity` fail under the Squeal daemon (001-390); name them, do not fix them.

Done when, each red on main first where it can be: 011-22's done-when 1 to 8 in `research/catch-up.md` as tests, with a fake runner of fixed durations and an injected pool; and done-when 9, the cezar replay (`research/probes/catch-up/replay-733.mjs`) on the slice's selection, recorded with the load in the notes. A live cezar measurement is the coordinator's, below load 8.

## W2: 011-23, a stale file adopts a result another worktree stored at its key

Use /worker. Shape: slice. Read board row 011-23, spec 011 C4 step 3 as amended 2026-10-20 (`status.md`), C5 (provenance, an inherited fail's confirmation), `research/catch-up.md` (finding 3, option (b), the Recommendation and 011-23's done-when) and its probes `adoptable.mjs` and `adoption-cost.mjs`. Base: `cand/0.1.225`, rebased onto main once it lands. W1 (011-22) runs beside you on the queue, `revision.ts`, `batch.ts` and `tiers.ts`: do not edit those; call your read from the scheduler's pump before `selectTier` and from the reconciliation pass, and name any line you must touch in another owner's file in its own commit.

Outcome: each reconciliation pass and each tier selection read the keys stored since the last read (`results_by_time`, with an overlap that covers a late commit and a busy store's retry wait, 001-422), and settle this worktree's files whose key has no result here through C4 step 3's lookup, keeping provenance and holding an unconfirmed fail; nothing is queued that policy did not queue.

Owns: a new module under `src/core/scheduler/` for the read and its watermark, the results repository query it needs, the reconciliation hook in `src/core/daemon-loop/`, their tests. Write `tasks/011-23/notes.md`. Leave the board, `status.md`, `spec.md`, versions and `plugins/*/dist` to the coordinator. Raise `KEY_FORMAT_VERSION` only if a guarded source changes; W1 may raise it too, the coordinator reconciles. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output; do not run `npm run build`. `run-reads-fidelity` and `observe-fidelity` fail under the Squeal daemon (001-390); name them, do not fix them.

Done when, each red on main first where it can be: 011-23's done-when 1 to 4 in `research/catch-up.md` as tests, plus the overlap margin measured or bounded in the notes; done-when 5, cezar live, is the coordinator's below load 8.

## W3: 011-22 and 011-23, review of cand/0.1.226

Use /reviewer. Shape: review. Pinned to the `cand/0.1.226` SHA named in the spawn; the range is `origin/main..<sha>`: W1's seven commits (011-22, catch-up), W2's six (011-23, adoption), the release commit (version 0.1.226, `KEY_FORMAT_VERSION` 17 re-pinned for both, the bundles) and this brief. W1 and W2 were written apart on `c141fa8f` and meet here in `scheduler.ts`.

Read W1 and W2 above, spec 011 C4 steps 3, 4 and 5 as amended 2026-10-20 (`status.md`), C5, C10 and C15, `research/catch-up.md`, `tasks/011-22/notes.md` and `tasks/011-23/notes.md`. Check that:
- a revision of 10 or more keyed paths, and only such a revision, queues catch-up, whatever its trigger, the daemon start included; the count happens once per revision and reaches the runner part's direct importers;
- catch-up runs on the backlog's route (grant, wall, slots), after the first group and ahead of the rest of the second, failing then shortest first; a later edit cancels a catch-up Vitest tier and its remainder stays catch-up, or runs beside node:test and pytest slots; the fifth-tier turn takes catch-up first, with the backlog's grant and slot, and yields to edits on the pool; a named wait still promotes;
- adoption reads only keys recorded since the last read with the 120 s look-back, uses `results_by_time`, writes nothing on a pass with nothing new, keeps provenance, holds an unconfirmed fail (C5), queues nothing policy did not queue, and restores the ledger when a busy store fails the commit;
- the two slices compose: an adopted file never runs again as catch-up, a catch-up file another worktree just stored is adopted rather than run, and the pump's adoption before `selectTier` does not starve or reorder catch-up;
- `KEY_FORMAT_VERSION` 17 is right against the released 16 (0.1.225).

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; a file that fails loaded and passes alone is named. Write `reviews/wave-5.md` with a PASS or FAIL verdict and commit it.
