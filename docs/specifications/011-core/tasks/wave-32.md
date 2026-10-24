# Wave 32

From main after the tests-only w31 landing, beside the review of `cand/w31b` (011-179). One row on the host-load probes; it lands as docs, like 011-138 and 011-155 did.

## W11: 011-177, `waste.mjs` counts a module the cancel cut in its grace as cut, not ended

Use /worker. Shape: repair (probe).

Outcome: the daily's `cancelled` table names, per cause, how many started files the cancel cut and their recorded seconds.

Read board row 011-177; `tasks/011-136/notes.md` sections 2 (F1), 6 and 8; `research/probes/host-load/README.md` ("How `waste.mjs` counts C3", "Files that never started").

Seam: `namedIn` in `research/probes/host-load/waste.mjs:20`. A lead: note the line `squeal: run cancelled` and give `ended` only the `MODULE` lines before it; then add `cut` and `cutSeconds` to each `cancelled` cause (named in the log, not in the report's `completedFiles`, no `MODULE` line before the note). `tasks/011-136/probes/cut.mjs`'s `parse` is the reference.

Owns `research/probes/host-load/waste.mjs`, the README's text on it, `tasks/011-177/`. Not yours: `src/`, `test/`, the other probes, `tasks/011-136/`, the board, spec text.

Done when, on a fresh pair of store copies (each with its `-wal` and `-shm`, then its run logs, under `nice -n 10 ionice -c3`; 011-136's copies are deleted), each project's `cut` equals `cut.mjs`'s started-and-cut count over the same window, `neverEnded` equals `cut` plus `neverStarted`, and C3's `keptShareStarted` is unchanged from today's script; the README names both new fields; the outputs and the load are in `tasks/011-177/notes.md`; commit. Read only on copies: never open a live store or socket, never run a script under `evals/bin/`, no `npm run build`.
