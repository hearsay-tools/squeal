# Wave 30

From main after 0.1.288. Two rows on disjoint seams, run side by side: W5 changes tests only, W6 changes the focused text's pattern. They go into one candidate; the coordinator integrates.

## W5: 011-175, the 011-137 validity case gives one output on every run

Use /worker. Shape: repair (test).

Outcome: the validity case "a step-down's cancel completes a module that ended whole in its grace (row 011-137)" stores the same thing on every run, on a loaded host and on CI.

Read board row 011-175; `tasks/011-137/notes.md`; `reviews/0.1.287.md` B1 and `reviews/0.1.287-r2.md`; 011 C9 (the step-down sentence).

Seam: the fixture `WHOLE_IN_GRACE` (`test/keys/validity/cases/adapter/vitest.ts:126-147`) and the run loop (`test/keys/validity/harness/vitest.ts:111-128`). First find which leg differs: repeat `test/keys/validity/adapters.test.ts -t "change a stored fingerprint"` about 20 times beside other Vitest load, and record whether each leg stored the pass. A lead: the harness cancels once `$STARTED` exists, 500 ms after the test ended, but nothing proves the reporter has the test's pass by then; wait on that evidence instead of a delay.

Owns `test/keys/validity/cases/adapter/vitest.ts`, `test/keys/validity/harness/vitest.ts`, `test/keys/validity/adapters.test.ts`, `tasks/011-175/`. Not yours: `src/` (if the fix needs it, stop and send me a request), `src/runners/focus.ts` and `src/runners/vitest/` (W6), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W6: 011-173, a focused text's ` > ` matches only the full-name separator on Vitest 5

Use /worker. Shape: slice.

Outcome: on Vitest 5, the text `a > b` starts no check whose full name matches it only with a space; Vitest 4 and node:test keep today's pattern.

Read board row 011-173; `reviews/0.1.278.md` N1; 013 V4; 011 C14.

Seam: `checkTextPattern` (`src/runners/focus.ts:39-43`) and the post-filter (`src/runners/vitest/reporter.ts:93`). A first edit: give the pattern the separator rule as a parameter, and pass the strict rule from the Vitest adapter on Vitest 5 or later.

Owns `src/runners/focus.ts`, `src/runners/vitest/`, their tests outside `test/keys/validity/`, `tasks/011-173/`. Not yours: `test/keys/validity/` (W5), the board, spec text (write the C14 or 013 V4 line you propose in your notes), bundles, version. If the key-format alarm asks for a raise, stop and send me a request. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
