# 011 wave 126: two worktrees changed at once share the background ceiling from the start

Row 011-424. Coordinator 4abb5168, 2026-11-21 (the human, card of 2026-11-20 on `research/simultaneous-demand-2.md`: "Build both changes"). One worker, one candidate, one review, benchmark before review (process step 6c, boat.dev only).

## W1: 011-424 a quiet that holds backlog states its demand; a backlog tier's share divides the ceiling

Use /worker. Shape: slice. Claude opus, high.

**Outcome.** When two worktrees are changed at the same moment, both start their first backlog tier together at a fair share of the background ceiling, not 9 + 1. Two parts, both as measured by rows 011-420 and 011-423 (arm qc):

1. While a lane's wait for quiet (C4 step 5) holds queued backlog files and ends within 30 s, the daemon's pool mark states them as demand: `want` the held files, at most 64, no grant. The mark is written at each pump look while the quiet holds, at most every 5 s when unchanged; the demand ends when a tier asks or the quiet ends. Other daemons' fair shares count it as they count a waiter's mark.
2. A backlog tier's fair share divides the background ceiling's CPUs (021 D18; rounded down, at most the slots) instead of the host's slots.

**Read first.** `research/simultaneous-demand.md` (the mechanism, the spec text to land, the risks for one worktree) and `research/simultaneous-demand-2.md` (re-measured on 0.1.578; "lag to width"). The prototype is `research/probes/simultaneous-demand-2/qc-ceiling-share.patch` (on 0.1.578, files `src/core/capacity/pool.ts`, `src/core/scheduler/{capacity,quiet,tier-live}.ts`). It is a probe, not the design: write it to the styleguide, with tests. Spec 011 C4 step 5 and C10 (Backlog and checkpoint tiers, Size), spec 021 D18, `src/core/capacity/{pool,share,marks}.ts`. Check how row 011-418's `shareBudget` and `fullWidth` (min of ceiling, hostSlots, project slots) read the share now, and say in notes whether the two agree.

**Constraints.** No change with one daemon (the local pool probe gives 9 in every arm: keep a test of that). The marks' file format does not change; an older daemon must read the quiet's mark as a holder's demand with no grant. Edit tiers and the checkpoint gate (`cores < hostSlots || grants < hostSlots / 2`) are unchanged. Named waits stay outside the ceiling (021 D18, row 011-412). A quiet that keeps restarting must not hold another daemon to half the ceiling for long: an edit withdraws the demand within one pump look. No host-tuned numbers (30 s lead and 64 files are rules, not tuned to this host; say in notes if you would derive either from the machine).

**Owns.** `src/core/capacity/**`, `src/core/scheduler/{quiet,capacity,tier-live}.ts`, their tests. Leave alone: spec files (the coordinator lands the amendment), `src/cli/**`.

**Done when.** Tests that fail on 0.1.578 and pass: (a) two daemons, one holding backlog in its quiet within 30 s of the end, the other asking: the asker's grant is its fair share of the ceiling (5 of 9 with two), the quiet one's first tier gets the rest (4); (b) one daemon alone gets the whole ceiling (9); (c) the quiet's demand ends on a new edit and on the tier's ask; (d) a mark from a quiet daemon is read by an unchanged older reader as demand with no grant; (e) existing pool, share, marks, quiet, tier-live and 011-417/418/419 tests pass. Notes in `tasks/011-424/notes.md` with the proposed C4 step 5 and C10 text (start from `research/simultaneous-demand.md`, "Spec text").

Rules: no version raise, no `pnpm run build` in your worktree, no full suite. Every direct `vitest` run gets `timeout`. Grep all of `test/` (e2e included) for the paths you change and run each such e2e file directly, one at a time, `timeout 900`. Before you report, read `squeal status --wait 60000 <changed-path>...`. Write `~`, never a home path; no company or VM host names. Heavy or quiet-host work goes to boat.dev (`~/projects/notes/topics/boat-dev.md`), not this host or the lab VM.
