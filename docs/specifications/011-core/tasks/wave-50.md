# Wave 50

From main after 0.1.335 (`5b3af3f0d`), 2026-10-26. Two repo-local refactor rows on disjoint seams; no line, JSON field, exit code or key changes. Row 011-238's slice 1 shipped with 011-243 (0.1.335), and its slice 2 goes with 011-241 because both edit the named wait. Host load is about 3 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-241 with 011-238 slice 2, the named wait's asked runs have one owner

Use /worker. Shape: slice. Rows 011-241 and 011-238 (slice 2 only); `quality/2026-10-26-b.md` slice 3 and `quality/2026-10-26-a.md` slice 2; `tasks/011-207/notes.md`.

Outcome: one object owns a wait's asked runs, and `NamedSelection.unmatchedPaths` and `paths` are required with their fallbacks gone.

Seam: `waitForNamed` (`src/cli/status-wait-paths.ts`, 575 lines on this baseline; `asked` and `unpromoted` from about `:285`). First edit, offered as a lead: the owner object in `src/cli/status-wait-ask.ts`, then the texts moved to `src/cli/status-wait-ask-lines.ts` as row 011-241 says. Slice 2: the fallbacks at `named-file-lines.ts:177`, `named-path-lines.ts:14` and `:31`, `status-wait-paths.ts:463` and `:554`.

Owns those files, `src/cli/named-selection.ts`, and the tests that build a selection by hand or import the moved texts. Not yours: `src/core/`, `test/scheduler/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when row 011-241's done-when holds (CC 45 or less for the read closure, no new function over 20, `status-wait-paths.ts` under 530 lines or the reason it cannot be, each ask file under 300) and slice 2's fields are required with no `??` fallback left; the evals parser gate round-trips the wait's lines unchanged.

## W2: 011-238 slices 3 to 5, three repeated names and rules get one owner

Use /worker. Shape: slice. Row 011-238 (slices 3, 4 and 5); `quality/2026-10-26-a.md` slices 3 to 5.

Outcome: the change feed's last delivered pass is named `deliveredPass`, one `src/core/status/` function applies `withLate(withStopping(withDeath(…)))`, and `stillClock` is gone.

Seam: slice 3 at `src/core/types/watcher.ts:145` and `src/core/watcher/change-feed.ts`, with its readers in `daemon-loop/index.ts` and `scheduler/scheduler.ts`; slice 4 at `readLiveHeader` (`src/core/delivery/liveness.ts`) and `src/core/status/snapshot.ts`; slice 5 at `test/scheduler/tier-yields-named.test.ts:60`, using `ModelClock` uninstalled. One commit per slice.

Owns those files and their tests. Not yours: `src/cli/`, `livenessChange`'s behaviour (it stays without `withDeath` and `withLate`), the board, spec text, bundles, version. No `npm run build`.

Done when each slice's code is as the quality file words it; no line, header or JSON changes; the affected tests pass; `test/keys/key-format.test.ts` passes with no version moved.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. The installed Squeal may still be 0.1.334, whose selection of a source path can miss readers (row 011-233): run each test file that imports a changed module directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits. Never open a live store, socket or permit pool from a probe. Make no CPU load on purpose.
