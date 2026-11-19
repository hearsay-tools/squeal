# 011 wave 122: stalls an agent can see and get past (P2)

Rows 011-396 to 011-399, chosen by the human 2026-11-19 (card of coordinator b99e3c05: "fix all four"; hung file "report + unblock others"). Evidence: `../research/stuck-running.md` (row 011-394, lab VM, Squeal 0.1.563). Issues #181, #233, #232, #139. Four workers in parallel, one candidate, one review.

Rules for every worker: no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage: grep ALL of `test/` for paths you change and run each such e2e file directly, one at a time, `timeout 900`. Every direct `vitest` run gets `timeout`. Before you report, read `squeal status --wait 60000 <changed-path>...`. Write `~`, never a `/home/<user>/` path; no company or VM host names. Notes in `tasks/<row>/notes.md` with a proposed spec amendment (011 C4/C6/C15, 005 D2) in plain text; the coordinator lands it. A key-format or validity change needs a case in `test/keys/key-format.test.ts`; say so in notes.

## W1: 011-396 list only the newest revision of an edit stream

Use /worker. Shape: repair. Outcome: while edits arrive faster than the daemon lists them, it lists only the newest revision, as a restart does now; a queued tier starts within one listing of the last edit.

Read: research E4, E4b, E4c; `src/core/scheduler/runner-work.ts` (about 54-58, 265-271), `refinement.ts` (168-177), `step.ts` (233-237), `revision.ts`. First edit: where runner work for a revision is queued, drop queued (not started) listing work that a newer revision supersedes. Keep correctness: a superseded revision's added or deleted test files must still be seen by the newer listing.

Owns: `src/core/scheduler/{runner-work,refinement,revision}.ts`, `step.ts` only where listing gates tiers, their tests. Leave alone: `decide-yields.ts`, `yields.ts`, `src/core/status/**`, `src/cli/**`, request intake.

Done when: a test with 20 revisions queued in 60 s lists at most two of them (the in-flight one and the newest), a test file added in an intermediate revision and kept is listed, one deleted in between is not, and tiers start after the newest is listed.

## W2: 011-397 `run <group> <path>` moves a known queued file ahead

Use /worker. Shape: repair. Outcome: `squeal run tests <file>` on a file already queued promotes it as `status --wait <file>` does (C15 batch), so "which run now" is true; its `--wait` returns the file's verdict.

Read: research E1, E1b; `src/cli/run.ts`, `src/cli/run-group.ts`, `src/core/scheduler/request-intake-requests.ts`, `narrow-run.ts`, `src/core/daemon/handlers.ts`; spec 011 C15, 005 D2. First edit: in request intake, give a run request for a queued file the same promotion a named wait gets.

Owns: those files and their tests. Leave alone: `runner-work.ts`, `refinement.ts`, `decide-yields.ts`, `yields.ts`, `src/core/status/**`, `src/cli/verdict.ts`.

Done when: with 800 files queued, `run tests <queued file> --wait 60000` gets its verdict before the queue's other files; a file with a current result is not re-run unless forced, as now; receipts name the promotion.

## W3: 011-398 a named wait judges its named files; status texts say what is true

Use /worker. Shape: repair. Outcome: (c) a named wait or snapshot whose named files are all current exits 0 (or 1 with failures) while the worktree's revision is not listed yet, unless the unlisted revision could change the named set (a named path that is not a known test file); (d) "it waits for the run in flight, each of its calls bounded at N s" appears only when a run is in flight, and "what holds it is unknown" names the listing when the listing holds it.

Read: research shape 2 (c, d) and #232; `src/cli/verdict.ts` (about 100-115, `unlisted`), `src/core/status/next-step.ts` (about 280-290), `src/core/status/standing-yields.ts` (55-63); spec 005 D1/D2.

Owns: `src/cli/verdict.ts`, `src/core/status/next-step.ts`, `src/core/status/standing-yields.ts`, their tests. Leave alone: `src/core/status/tier-text.ts` (W4), scheduler files, `src/cli/run*.ts`.

Done when: tests: named current passing files during an unlisted revision exit 0; a named source path during it still exits 3 with the listing named; the in-flight text is absent with no run open; the old texts appear nowhere in fixtures.

## W4: 011-399 a file far past its own time is reported, and does not block its lane

Use /worker. Shape: slice. Outcome: when every unfinished file of a running tier has run at least 10 times its own last-known duration and at least 60 s (no known duration: 60 s past the tier's estimate), the lane starts its next tiers beside it in a second runner instance, as for a batch's tier (C4 step 5, row 011-269); the long file keeps running to `runner.timeoutMs`, and nothing about its result changes. Status, the named wait's line and the hook say: running N min, about Mx its usual time, may be hung, the deadline, and the command that shows it (`squeal why <file>` or the run log). No cancel, no new result kind.

Read: research shape 1, "What can Squeal know", E1b; spec 011 C4 step 5 (the beside-instance and yield rules); `src/core/scheduler/decide-yields.ts` (226-227), `yields.ts`, the beside-instance code for batch tiers (grep `beside`), `src/core/status/tier-text.ts`, `src/cli/named-file-lines.ts`. The daemon knows only `fileEnded`: unfinished = not ended.

Owns: `decide-yields.ts`, `yields.ts`, the beside-instance code, `src/core/status/tier-text.ts`, `src/cli/named-file-lines.ts`, `status-wait-lines.ts`, the hook's running line, their tests. Leave alone: W1-W3 files. Overlap with W1 in `step.ts`: touch it only if you must, and name the lines in notes.

Done when: with a 4-file tier where one file blocks (as the research's `hang.test.ts`) and 1,000 queued, other files start within the threshold plus one tier's start; the blocked file still ends by timeout with `unknown` as today; status text and JSON carry the overrun (additive fields); a slow file under the threshold changes nothing.

## Review brief

Use /reviewer. One candidate for rows 011-396 to 011-399; the range is the candidate's commits over `origin/main` at its base. One section and verdict per row, then PASS or FAIL. Check especially: W1 never loses an added/deleted test file; W4 never changes a stored result and its beside instance respects the CPU ceiling (C10).

## Added 2026-11-19: partial selection lists (the human: "label now + find cause")

Evidence: a read-only selection audit of the squawk repository (Squeal 0.1.563), summarised on [#242](https://github.com/hearsay-tools/squeal/issues/242) (comment of 2026-11-19): `squeal status <source path> --json` at one revision gave `selection.testFiles` lengths 688 / 1 / 1, 2 / 2 / 701, 315 / 18 / 315; the short ones had `selection.reason: "unsynced"`, the long ones matched an independent import-graph model.

### W3b: 011-401 a partial selection says it is partial (worker of W3, after 011-398)

Use /worker. Shape: repair. Outcome: while a selection's list can be incomplete (`unsynced`, `unlisted`), the plain text says "at least N test files; the list is partial while Squeal catches up with revision R" and the JSON adds `selection.complete: false` (additive; `true` otherwise). Owns: W3's files plus the selection JSON writer (name it in notes). Done when: tests for both reasons and for a complete selection; the help text names `complete`. Separate commit(s) after 011-398's.

### W1b: 011-402 why a complete selection shrinks at one revision (worker of W1, after 011-396; investigation)

Use /worker. Shape: survey. Outcome: notes in `tasks/011-402/notes.md` naming the code path that makes `status <source path>` return 688 files, then 1, at one revision: for example a read of `test_file_imports` or the reverse index while the runner part rewrites them (`src/core/store/import-edges.ts` 179-189, `src/core/scheduler/stored-affected.ts`), or keys read across two revisions. Reproduce with a test in your worktree if cheap (under 30 min, `timeout` on every run). No product change unless it is a one-transaction fix inside your files; otherwise propose the fix in notes.

### W1c: 011-403 an unsynced snapshot selects from the stored import graph (worker of W1, after 011-402)

Use /worker. Shape: repair. Cause from `tasks/011-402/notes.md`: `status <path>` without `--wait` waits 750 ms for the daemon's sync; when late, `selectNamedFiles` gets no readers and falls back to the store rule (`test_files`, one closure per file, valid only at the writer's current key; 011-234 finding 1), so 688 files become 1. Outcome: that fallback unions the per-key import graph (`readImportGraph`) with the store rule, so an unsynced snapshot lists the same readers as a synced one when the graph holds them; it stays labelled partial (011-401). No added wait. Owns: the fallback in the selection path (name the files in notes) and `test/cli/snapshot-selection-shrinks.test.ts`. Done when: that test lists 13 of 13 while unsynced; a source path the graph does not know still reads partial.
