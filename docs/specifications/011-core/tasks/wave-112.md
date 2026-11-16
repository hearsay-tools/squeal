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

## R1 (W1, with the W2 pilot): review of cand/0.1.524

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.524` at `0d4e11971c2e1691b62c08c270f7c39c76f7fde8`; candidate CI run 43899182157. Range `f17f9146b..0d4e11971c2e1691b62c08c270f7c39c76f7fde8` (main at 0.1.523 plus docs): worker 2249b18f's seven commits (row 011-377), the W2 survey's pilot commit (row 011-371: seven test files outside `test/scheduler/` move from `Scheduler.idle()` to `rest()`), then the 0.1.524 raise and bundles. Read: board rows 011-377 and 011-371; this file's W1 and W2; `tasks/011-377/notes.md` (its Design first); `tasks/011-371/survey.md` "Pilot"; `reviews/0.1.523.md` N2 and "Inputs for the coordinator".

Check, each as proven, plausible or unverified:

1. **A calendar step moves no wait.** A change of 100 ms or more in (calendar minus elapsed) is a calendar step; each wait owner moves the calendar times it keeps by the step; a stored time counts from when this daemon first saw it. Every wait the design lists (edit quiet for a lane and a slow group, a requested wait's deadline, the claims window and the foreign-run limit, the slow lane's idle limit, the yield bound and a tier's time left, the 2 s finished-count write limit, the drain time) ends after its elapsed time across a 1 h set-back and set-forward; `calendar-steps.test.ts` and `calendar-steps-scheduler.test.ts` would fail without the mechanism; the flipped `clock-port.test.ts` case.
2. **The threshold.** 100 ms is justified as the notes say (reading jitter, NTP slewing, NTP's step threshold) and is not host-tuned; a slew or jitter never reads as a step; a real step under 100 ms leaves at most that error.
3. **What stays the same.** Nothing stored, published or compared with another daemon changes shape or value; status payloads, note text, CLI output, tiers, order, width and keys are unchanged without a clock change; every decision still reads the step's one reading (row 011-372; `step-reading.test.ts`'s edit keeps its meaning); a command hold's end stays on calendar time, as decided, and the glossary names it as the one exception.
4. **The known limit** (a step inside one scheduling step can put that step's decision off by the step; the next is right) and the copy outside the scheduler (`src/core/lint/pass/idle.ts` repeats the edit-quiet calculation and still follows the clock): say whether either is a defect a user sees, and how often.
5. **The fixture edits** (`test/helpers/virtual-clock.ts`: a harness's `advance` moves elapsed time too; `claims-expiry.test.ts` case 10) keep every user's meaning.
6. **The pilot.** The seven files' only change is `scheduler.idle()` to `rest()` (or the side's `rest()`), and each wait ends at the same point as before (survey class A).

Coordinator at the candidate: lint, typecheck, `check:version origin/main`; `key-format` 12/12 alone; `version-sensitive`, the clock and calendar-step files, `step-reading`, `claims-expiry`, `one-loop-source`, `wakes` and three pilot files 78/78 at load 30. Worker: model test at load 21 to 24; 136 daemon and scheduler files run directly, all pass; Squeal 690 affected files pass, 232 still queued (mostly `test/cli`, `test/harness`, `test/integration`). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/0.1.524.md` and commit it on your branch.

## W1 repair: after review 0.1.524 (FAIL)

Use /worker (worker 2249b18f, resumed). Shape: repair. Effort high. Read `reviews/0.1.524.md` in full; it names each seam and a fix scope. Base: your branch; the coordinator integrates.

1. **B1.** After a calendar step, the republished quiet and promotion rows must still show in status while their owner enforces them, and a predecessor daemon's row must still be rejected. Make the publication and the reader's freshness rule agree across a set-back. If this needs a change to what is stored or published (a row's shape or a new field), message me with the design before code. Tests: owner to public reader, for quiet and promotions, with a real daemon-start value, set-back and set-forward, plus a genuine predecessor's row rejected.
2. **B2.** A step between a decision and its wake's delay must not add the step to the delay. Derive the delay from the same reading as the decision, or keep it on elapsed time. Cover `SlowRelease.arm` (proven), and check `scheduler.ts` `#eventOrAt` and `TierYields.#arm` (plausible). Tests: the review's wrapper that steps the clock between the two reads, both directions.
3. **S1.** Reject an uncertain sample: bracket the calendar reading with elapsed readings and ignore a pair whose width could hide a step. Test: a delayed sample with no calendar change reports no step. Document the limits of the NTP assumptions; do not tune the threshold to this host.
4. **N2.** `GLOSSARY.md`: narrow "the one wait" to scheduler waits and name the lint edit-quiet copy (`src/core/lint/pass/idle.ts:49`), which row 011-382 holds. Not yours: that lint file.

Keep row 011-372 (one decision reading), the command-hold exception and unchanged behaviour without a step. Done when: each blocker's test failed before its fix; notes gain "Repair after review 0.1.524"; lint, typecheck, `key-format`, the model test once, and the changed tests pass; `squeal status --wait 60000` on the changed paths (report pending as pending).
