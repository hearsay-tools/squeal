# Research brief: can the per-session view stop being a copy of every state

Row 005-104, asked by the human 2026-11-17 ("Why do we copy the state? Doesn't that expose a flaw by itself?"). Coordinator: session 4d2ecbfc. Use /researcher. Findings file: `consumer-view-design.md` beside this brief. A design note with evidence; no product code changes.

## What exists

`consumer_views` holds, per session and check, the outcome and fingerprint last told (`src/core/store/schema.ts`). A registration seeds it with every known state of the worktree (`registerNow`, `toView`), so that a delivery's delta is "states that differ from the view" (`src/core/delivery/delta.ts`, `planDelta`). The seed costs time in proportion to the worktree's states at every session start (`session-start-cost.md`: about 32,000 states in cezar, 17,000 in squeal; row 005-103 makes the write one statement but keeps the copy).

## Question

Is there a design where a registration writes a constant amount (a starting point) and the view holds only what was told or differs, and which keeps every rule the delta has today? The transitions log already records each state change (`TransitionRepo.history`).

## Do

1. List every rule that reads or writes the view, from the code and its tests, each with its spec line: first observations written silently, `beforeFailing` and "first observed", a changed failure, a retired check told as a failure, the own-edit PASS to UNKNOWN rule (001-220), inherited and imported origins, a re-registration and a parked view, the late state and the own count (005-93, 005-97, 005-100), peek and Stop paths, pruning.
2. For each candidate design (at least: a registration position in the transitions log plus rows only for told or differing checks; a per-worktree change sequence on `known_states` with a per-consumer watermark; the copy as now), say per rule whether it holds, with the case that breaks it if not.
3. Measure on copies of the real stores (the copies of row 005-101 may still exist under that researcher's scratch; else make your own, read-only on live stores): the registration's cost and a delivery's cost under each design, as SQL on the copy, median of 15 runs, with the host load.
4. State the migration: what happens to live sessions' views at an upgrade.

## Limits

Read-only on live stores and other tasks' worktrees; copies in your scratch only; no artificial load; never run `evals/bin` scripts; never run a script to check it. Write `~`, never a `/home/<user>/` path.

## Deliver

The rule table; the designs against it; the measurements; a recommendation with its owner (005 delivery, 011 store) and its risk; what stays unknown. If no design keeps every rule, say which rule would have to change and what the agent would see.
