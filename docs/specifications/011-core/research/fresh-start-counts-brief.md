# Research brief 011-223: can a new worktree show its inherited counts at registration

Use /researcher. Shape: research. Outcome: where the 30 to 40 s between a new worktree's registration and its first listed header go, and whether a listing another worktree already made at the same content could answer the first header safely, with what it would save.

## Why

The human (2026-10-25, cezar task 017527fd) asked why a fresh worktree's SessionStart says `0 current` when 1,116 of 1,117 files were inherited (9,982 results from 5 worktrees) about 30 to 40 s later. Since 011-205 the first header after the listing carries the counts; the human chose "research same-commit reuse" over a bounded wait at SessionStart or no change.

## Read first

`research/missed-sharing.md` (a fresh clone found 920 of 934 at equal content); `research/main-daemon.md`; row 011-205 and `src/core/delivery/header.ts`; 011 C3 (keys, declared inputs, observed reads), C4 step 3, C5, C9 (start); 001 D7 as amended.

## Questions

1. **The wait.** From registration to the first listed header in a fresh clone of squeal and of cezar: seconds per step (daemon start, runner listing, closures, hashing, store lookup), with the one-minute load beside each.
2. **What a listing depends on.** Which inputs to the file list, closures and keys differ between two worktrees at one commit (ignored paths, `node_modules`, absolute paths, observed reads, environment), read in source and shown on two clones.
3. **Reuse.** Whether a listing or key set stored by another worktree, matched by commit or by tracked-content hash plus the inputs in 2, could answer the first header at registration; how often on this host a new worktree starts at content some worktree already listed (from store copies, 72 h); what the real listing must then correct, and how a wrong early count would show to the agent.
4. **Cheaper listing.** Whether steps in 1 can be made faster without reuse.

## Rules

As in `research/missed-sharing-brief.md` Rules: store copies only, clones under `/tmp` with isolated homes, nice 10, at most 4 test workers. Time nothing while the one-minute load is above 24 on 24 CPUs; wait, then say how long you waited. Tag every finding. No design beyond options with costs. Budget about three hours.

Own `research/fresh-start-counts.md` and `research/probes/fresh-start-counts/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 4 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
