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
