# Research brief 011-394: why a test file stays "running" and focused requests wait until a restart

Use /researcher. Shape: research. Outcome: the mechanism behind each of three stall shapes below, each reproduced on the lab VM or given a stated reason it has none, tagged as a Squeal defect, expected behaviour, or a measurement artefact.

## Why

The human made this priority 1 of 5 on 2026-11-19 (design first; no implementation from this row). Squawk workers on Squeal 0.1.550 to 0.1.563 reported, each cleared by `squeal stop` then `squeal start`:

1. **A file stays "running" far past its estimate** ([#233](https://github.com/hearsay-tools/squeal/issues/233) and its 2026-11-19 comments): 5 times across 4 worktrees, 10 to 53 minutes, once with a 70 s stale heartbeat, once after the daemon died without shutdown; once it hid a real failure for over 10 minutes.
2. **Focused requests for known files expire while a revision is listed** ([#181](https://github.com/hearsay-tools/squeal/issues/181), comments of 2026-11-17 and 2026-11-18): `testFilesListed: false`, "waits for an in-flight tier, whose per-call bound is 966 seconds"; "queued, no run open and nothing recorded holds it" (also [#139](https://github.com/hearsay-tools/squeal/issues/139)).
3. **A wait held by another worktree's run of the same key** ([#179](https://github.com/hearsay-tools/squeal/issues/179), 2026-11-19 comment), and `status --wait` exiting 3 while every selected file is current ([#232](https://github.com/hearsay-tools/squeal/issues/232)).

## Read first

`docs/vision.md`; the triage findings `research/issue-233.md`, `issue-181.md`, `issue-179.md`, `issue-232.md`; spec 011 C4 (scheduler), C6 (status), C9 (heartbeat and lifecycle), C15 (named demand); rows 011-210 / gh-87 and 003-50 / gh-95 for overlap.

## Where to run

On the lab VM in the shared notes (`~/projects/notes/topics/`, the VM topic): read that note first, check its load and state it, work under `~/work/011-394/`, delete it and leave no process at the end. Install Squeal 0.1.563 there from its release. A large fixture comes from a `git bundle` of a repository on this host copied over; never copy credentials. Nothing heavy on this host.

## Questions

1. For shapes 1 to 3: which code path keeps the state, and what clears it at restart? Reproduce each at a scale near the reports (over 1,000 queued files).
2. Do the three share one cause? Give evidence for or against.
3. What can Squeal know, at the time, to tell an agent the file or request is stuck rather than slow (estimate overrun, process alive, holder identity)? Measure, do not design.

## Rules

Tag each finding. No design, no product code. Own `research/stuck-running.md` and `research/probes/stuck-running/` only. Budget about three hours. Done when questions 1 to 3 have tagged answers and the probe README says how to re-run it. Commit.
