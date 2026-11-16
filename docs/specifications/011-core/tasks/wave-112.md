# Wave 112: waits that count from a stored calendar time, and a survey of `idle()` callers (rows 011-377, 011-371)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Row 377: Approve"; "Idle sweep: Survey first"). Base: main at 0.1.523 (row 011-369, two named clocks). The two workers own disjoint files: W1 owns `src/core/scheduler/` wait owners and their tests; W2 changes no `src/` file and, for its pilot, no file under `test/scheduler/`.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-377

Use /worker. Shape: slice, design first. Effort high.

Outcome: a calendar change moves no wait inside one daemon. Waits that today compare a stored calendar time count on elapsed time locally, and the stored calendar time stays as the fact other daemons and the status read.

Read: board row 011-377; `reviews/0.1.523.md` (N2, "Inputs for the coordinator"); `tasks/011-369/notes.md` ("Waits still measured on calendar time", and the coordinator's addendum); `GLOSSARY.md` "Calendar time" and "Elapsed time"; `test/scheduler/clock-port.test.ts` (the case that pins the deviation) and `clock-change.test.ts`.

Seam: design first. Write a short "Design" section in `tasks/011-377/notes.md` before code: for each wait (quiet after an edit, a named wait's deadline, the claims window, a command hold's end, the idle bound, the yield bound, the drain time) say where its start comes from, whether it is this daemon's own start (keep an elapsed reading beside the stored calendar time) or another process's (count from when this daemon first saw it), and what a user sees after a clock jump. If a wait cannot move without changing what is stored, published or compared with another daemon, or a status payload, message me with the case and stop that wait. Then test first: flip the pinning case in `clock-port.test.ts` to the new expectation and add one clock-change case per wait on the virtual clock (`shiftCalendar`), each failing before.

Owns: `src/core/scheduler/` wait owners the design names (name each), `test/scheduler/clock-port.test.ts`, `clock-change.test.ts` and new tests; `GLOSSARY.md` "Elapsed time" (drop the exception it names). Leave alone: `busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9, 10), `record-tier.ts`. Keep row 011-372: decisions read the step's one reading.

Done when: row 011-377's done-when; behaviour preserved without a clock change (no tier, order, width, status payload, note text, CLI output or key change); `key-format` without a raise; lint, typecheck, `squeal status --wait 60000` on the changed paths; the model test once below the CPU count.

## W2: survey of `Scheduler.idle()` callers (row 011-371)

Use /worker. Shape: survey, with a small pilot. Effort medium.

Outcome: we know how the 307 test files that call `idle()` (213 under `test/scheduler/`) can move to `rest()`, sized into sweep rows from measurements, not guesses.

Read: board row 011-371; `GLOSSARY.md` "Rest"; `Scheduler.rest()` and `idle()` in `src/core/scheduler/scheduler.ts`; `tasks/011-363/notes.md` and `tasks/011-368/notes.md` (how earlier rows moved files: `clock: "virtual"`, `settle`/`rest()`); `test/helpers/virtual-clock.ts`.

Lead: classify every caller (a script over `git grep`, not by hand): files where `idle()` can become `await rest()` with no other change, files that also need the virtual clock, and files whose waits depend on real time. Then a pilot: move up to 10 files from the first class outside `test/scheduler/` (W1 edits there), each passing 3 of 3, and time the work. From the pilot, propose sweep rows of a size one worker finishes in one sitting, each with its file list, in the notes. Say whether `idle()` has any caller in `src/`, `evals/` or `scripts/`.

Owns: `tasks/011-371/survey.md` (the classification and proposed rows), the pilot's test files only. Done when: every caller is classified with a count per class; the pilot files pass 3 of 3 with load stated; the proposed rows add up to every remaining caller.

Both: lint, typecheck and `squeal status --wait 60000` on the changed paths; report pending checks as such.
