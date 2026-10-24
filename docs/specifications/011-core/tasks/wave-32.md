# Wave 32

From main after the tests-only w31 landing, beside the review of `cand/w31b` (011-179). One row on the host-load probes; it lands as docs, like 011-138 and 011-155 did. W12, added after W11 landed, is a survey on store copies; it lands as docs.

## W11: 011-177, `waste.mjs` counts a module the cancel cut in its grace as cut, not ended

Use /worker. Shape: repair (probe).

Outcome: the daily's `cancelled` table names, per cause, how many started files the cancel cut and their recorded seconds.

Read board row 011-177; `tasks/011-136/notes.md` sections 2 (F1), 6 and 8; `research/probes/host-load/README.md` ("How `waste.mjs` counts C3", "Files that never started").

Seam: `namedIn` in `research/probes/host-load/waste.mjs:20`. A lead: note the line `squeal: run cancelled` and give `ended` only the `MODULE` lines before it; then add `cut` and `cutSeconds` to each `cancelled` cause (named in the log, not in the report's `completedFiles`, no `MODULE` line before the note). `tasks/011-136/probes/cut.mjs`'s `parse` is the reference.

Owns `research/probes/host-load/waste.mjs`, the README's text on it, `tasks/011-177/`. Not yours: `src/`, `test/`, the other probes, `tasks/011-136/`, the board, spec text.

Done when, on a fresh pair of store copies (each with its `-wal` and `-shm`, then its run logs, under `nice -n 10 ionice -c3`; 011-136's copies are deleted), each project's `cut` equals `cut.mjs`'s started-and-cut count over the same window, `neverEnded` equals `cut` plus `neverStarted`, and C3's `keptShareStarted` is unchanged from today's script; the README names both new fields; the outputs and the load are in `tasks/011-177/notes.md`; commit. Read only on copies: never open a live store or socket, never run a script under `evals/bin/`, no `npm run build`.

## W12: 011-180 survey, what a tier's yield to an edit's work cuts and what it buys

Use /worker. Shape: survey.

Outcome: per project over 24 hours, the started files each yield cut, their low and high seconds, what the yield ran sooner and by how much, and one change that would keep more of them, or a reason not to change.

Read board row 011-180; `tasks/011-177/notes.md`; `tasks/011-136/notes.md` (a survey of the same shape: its sections 1 to 3 and its probes); `research/running-tier-yields.md` and `research/yields-replay.md` (rule B, 30 s, the human's choice in 001-381); 011 C4 step 5.

Seam: the `cancelled` cause `yield` in `research/probes/host-load/waste.mjs`; `tasks/011-136/probes/cut.mjs` with the cause changed; the decision in `src/core/scheduler/yields.ts:205`. The row's first question: did each yield meet rule B (an estimated remainder over 30 s, or an overrun), and how long did the work it yielded to then wait to start?

Owns `tasks/011-180/` (notes and any probe of your own). Not yours: `src/`, `test/`, `research/`, the other tasks' folders, the board, spec text.

Done when the row's done-when holds. The rule is the human's, so propose, never change. Copy each store with its `-wal` and `-shm`, then its run logs, under `nice -n 10 ionice -c3`; never open a live store or socket; never run a script under `evals/bin/`; no `npm run build`. Record the load beside each copy. Commit.
