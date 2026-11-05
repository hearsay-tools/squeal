# Research brief 011-298: why a restarted daemon re-runs what its predecessor stored

Use /researcher. Shape: research. Outcome: the causes, by share of seconds, of the test runs a cezar daemon's start baseline makes in a worktree whose earlier daemon already ran a baseline, each tagged as a Squeal defect, an expected re-key, or a configuration choice.

## Why

`019-run-triggers/research/load-split.md` (row 019-46, 72 h to 2026-11-05): cezar's daemon-start baselines are 59.1% of cezar's test seconds. 1,058 baselines came at a later daemon start of a worktree that already had one: 67,540 files, 385,151 s, 64% of baseline seconds. Cezar runs `baseline.onStart: "lookup-then-run-missing"` and its daemons exit after 60 idle minutes (`daemon.idleExitMinutes`). Open question 2 there: why a restart misses so many stored keys. The human approved this investigation on 2026-11-05.

## Read first

`docs/vision.md`; `019-run-triggers/research/load-split.md` (sections 1, 5, open questions) and its `probes/load-split/`; spec 011 on keys (C3), baseline and start (search `onStart`, `lookup`), daemon idle exit; `research/edit-load.md` method; the board rows for 011-33 (a restart resumes its predecessor's queued work) and 011-35 (results survive releases).

## Questions

1. **Classify each restart-baseline file run.** For each, say why the lookup missed. Candidates to check, not to assume:
   - the key changed: a pull or merge between daemons, a lockfile or install, a Node or runner version, a Squeal release whose key format moved;
   - the predecessor's queued work resumed (011-33);
   - the predecessor never stored the result (cancelled, timed out, the daemon exited mid-run);
   - a lookup that should have hit and did not (a defect).
   Give seconds and shares per cause.
2. **The defect share.** For any "should have hit", reproduce it in a fixture under your `$TMPDIR`: start, let the baseline finish, stop, restart with no change, and count the files run. Name the code path.
3. **What settings change.** From the data: what share a longer `daemon.idleExitMinutes` (for example 240) or `baseline.onStart: "lookup-only"` would remove, and what each costs (an earlier verdict lost, a daemon kept in memory).

## Rules

As in `research/edit-load-brief.md`, "Rules": copy stores with `-wal` and `-shm`; never open a live store, socket or permit pool; never run `evals/bin/*` or `tasks/*/probe/`; fixture experiments only in a fresh repository under your own `$TMPDIR`, at nice 10, at most 4 workers, stopped and removed at the end; no runs in cezar's or this repository's worktrees; tag each finding. No design. Budget about two hours.

Own `research/restart-baseline.md` and `research/probes/restart-baseline/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 3 have numbers and tags, any defect has a fixture reproduction or a stated reason it has none, and the probe README says how to re-run it. Commit.
