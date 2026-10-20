# 011-26 notes: `Known failures:` says what is not current

Worker notes for board row 011-26 (011-24 R1, gh-45). Brief: the `## 011-26` section of `../011-24/briefs.md`; design `../011-24/design.md` sections 2 and 5 R1; spec 011 C6 as amended 2026-10-20; `../../research/issue-45.md`. Baseline `2780cb12` (0.1.228, after 011-42's 0.1.227 reshaping of the waits).

## What changed

One clause, `notCurrentText` (`src/core/status/checks.ts`), ends every `Known failures:` line:

- `squeal status` (`src/core/status/format-status.ts`),
- the registration header (`src/core/delivery/format.ts`, `formatRegistration`),
- Stop: `statusText` and the news path's `knownFailuresLine` (`src/harness/shared/text.ts`, `src/harness/shared/stop.ts`),
- both waits' verdict lines, `status --wait` and `status --wait <ms> <path>...` (`src/cli/status-wait-lines.ts`, `worktreeText`). The clause replaces the old `checks N running, M queued; K test files without checks: r running, q queued` part and its "these counts are not complete" sentence.

Its forms, from gh-45's `zero` store:

```text
Known failures: 0; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)
Known failures: 0; all 2 test files current                                   (live daemon, listed, runner part done)
Known failures: 0; 2 test files current as of revision 26                     (no live daemon, or waiting for an install)
Known failures: 0; 2 test files current; revision 26 is not listed yet, so test files it adds are not counted
Known failures: 0; the daemon has not listed this worktree's test files yet
Known failures: 0; the daemon listed no test files                            (listed, zero files)
. Worktree: known failures 0; not current: 8 of 10 test files (2 queued, 6 stale), 80 tests (20 queued, 60 stale)
```

`StatusHeader` gains three optional fields (`src/core/types/status.ts`, additive), so `status --json` and every hook payload carry them: `testFileCounts: { current, pending, stale, unknown }`, `testFilesByPhase: { running, queued }` and `testsByPhase: { running, queued }`.

## Seam map

- `src/core/state/file-class.ts` (new): `fileClassOf` moved here from `src/cli/verdict.ts` unchanged; `countNotCurrent(states, keys, openFiles)` classes every key row by it and splits pending files and pending tests (kind `test`) by phase. Setup checks belong to no file.
- `src/core/state/header.ts` (`readHeader`): spreads `countNotCurrent`; a sixth optional parameter `openFiles`, the `testFileId`s the live daemon's open runs hold, so a file whose open run a re-key queued counts running (C15).
- `src/core/status/snapshot.ts`: reads the header after the open runs and passes their files (the same set `breakdown` uses).
- `src/core/delivery/liveness.ts` (`readLiveHeader`): reads the worktree's open runs with its liveness and passes them, so the registration header and Stop count phases as status does. Not in the brief's seam list, but it is the delivered header's only reader of `readHeader`.
- `src/cli/verdict.ts`: imports the class from `core/state` and re-exports `FileClass` and `fileClassOf`, so `named-files.ts` and `named-file-lines.ts` (011-27's files) are untouched. 011-27 may import from `src/core/state/index.js` directly and drop the re-export.
- `src/core/status/checks.ts`: `notCurrentText(header)` returns `""` or `; <clause>`; callers append it.
- `evals/lib/squeal-text.mjs`: `countsOf` reads the clause when the text has no header counts, news header or `Affected checks:` line, which is what a `tail -1` of a wait, or 011-28's short named wait, leaves. A file and its tests both count, so the sum matches today's checks plus test files without checks.
- Skill step 4, three copies (`plugins/{claude-code,codex,pi}/skills/squeal/SKILL.md`).

The waits' read budget is unchanged: the counts are one more pass over states and rows `readHeader` already holds, and `runs.inFlight` is not a known-state read. `test/cli/wait-reads.test.ts` passes.

## Tests

- `test/status/not-current.test.ts` (new):
  - gh-45 `zero` in status (plain and `readStatus`'s JSON), the registration header, Stop (`statusText` and `knownFailuresLine` with a header), and both waits' verdict lines.
  - Both waits through the CLI with `--json`: the snapshot's fields on stdout and the clause on stderr's verdict line.
  - Seeded cases, each checking `readHeader`'s `testFileCounts` against `readVerdict(store, wt, null).byClass`, the named wait's classes:
    - files without checks (queued, unkeyed, never run),
    - a re-keyed file an open run holds (running in status and in the header),
    - slow files,
    - a failed global setup's file.
  - `all N test files current` only with a live daemon; not with none, not while the runner part is pending, not before the listing; the unlisted revision after a not-current part.
- `test/evals/evidence-squeal.test.ts`: every variant's wait, named-wait and timed-out named-wait verdict line, read alone, plain and in hook JSON, says whether anything is not current as its status does. The `settled` fixture (`test/evals/status-snapshot.ts`) and the variants carry consistent file classes.
- Pins updated for the new text:
  - `test/status/status.test.ts`: the snapshot, the inline sample and the vision example, which now seeds its files' key rows,
  - `test/status/header.test.ts` and `test/status/known-failure-counts.test.ts`,
  - `test/status/slow-tier.test.ts`,
  - `test/delivery/delivery.test.ts`,
  - `test/cli/main.test.ts`, `status-wait.test.ts`, `status-wait-edit.test.ts` and `status-wait-paths.test.ts`,
  - `test/harness/hooks.test.ts`, `session-start.test.ts`, `user-prompt-submit.test.ts` and `codex/command.test.ts`.
- `test/e2e/transitions.test.ts` checks `toContain("Known failures: 0")`, which still holds; not run here (outside Squeal's coverage).

## What the design did not foresee

1. **The class lives in `src/core/state`, not `src/core/status`.** `readHeader` is a guarded key source. Its import of an exempt `src/core/status` file failed `test/keys/key-format.test.ts` "lets guarded sources import exempt ones only through these named seams" (and its per-build variants). Adding a seam to that list is a guard decision. Putting the file under the guarded `src/core/state` needs none.
2. **`testsByPhase`, a third field.** The tests part splits pending tests into running and queued. The delivered header has no `breakdown`, so the header carries that split itself. The design named only `testFileCounts` and `testFilesByPhase`, so the coordinator may want 011 C6's JSON list to name `testsByPhase` too.
3. **Wording the design left open.**
   - With no live daemon (resting, stopped, dead) or while waiting for an install, all current reads `N test files current as of revision R`. The header's sentence says why.
   - With the runner part pending and nothing else open, it reads `N test files current; revision R is not listed yet, ...`.
   - A listed worktree with no test files reads `the daemon listed no test files`.
   - One file reads `all 1 test file current`, which keeps the form uniform for parsers.
4. **Skill budget.** The design's step 4 sentence put `SKILL.md` at 5,016 characters, over `test/harness/skill.test.ts`'s 5,000. Step 4 now says `` `Known failures: 0; not current: …` means "no known failures yet" ``, the old sentence's meaning on the new line.
5. **Tests of a file without a key row.** The tests part comes from `counts`, which hold every state, while the files part counts listed files only. A seed with checks and no key row shows tests without their file (`status.test.ts`'s `src/broken.test.ts`; `session-start.test.ts`'s 40 stale tests). A daemon's store retires such checks, so I left it.
6. **Left for later rows.**
   - The edit and quiet lines' `; N checks ... pending in all` part stays (design 1.3, R4).
   - `references/commands.md` line 16 still says `` `Known failures: 0` with pending checks means "no known failures yet" ``. It is still true; R3 and R4 own that file.
   - `run --all --wait`'s checkpoint verdict is unchanged (C6, gh-34).
7. **Stop's poll** (`waitForPending`) now runs `countNotCurrent` on each poll over the states it already reads. There is no extra store read.

## Expected failures (bundled release)

- `test/keys/key-format.test.ts`: "is bumped whenever the guarded sources change" and "an adapter-only bump" for node-test and vitest. `header.ts`, `types/status.ts` and the new `state/file-class.ts` are guarded; no raise or re-pin, per the brief.
- The bundle-drift tests, since `plugins/*/dist` is not rebuilt here (named in the final report).
- `test/runners/node-test/run-reads-fidelity.test.ts` and `test/runners/vitest/observe-fidelity.test.ts` (001-390), failing on main too.
