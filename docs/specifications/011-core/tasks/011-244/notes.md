# 011-244 notes: a flaky note names only the inputs Squeal tracks

Row 011-244 (gh-98; wave 51 W1, `tasks/wave-51.md`; triage `research/issue-98.md`; 011 C5). Worker run `f7979153`, 2026-10-26. Baseline `0885eec11`.

## Cause

`flakyText` (`src/core/state/flaky.ts`) printed `FAIL -> PASS under the same inputs` for every flip under one key. A key holds only the inputs Squeal tracks: imports, observed runtime reads where a runner observes them, and the files `inputs` in `squeal.config.json` declares. A file a test reads that none of these covers can change between the FAIL run and the PASS run while the key stays. In gh-98 a node:test helper read `.github/cockpit-test-durations.json` with `readFileSync`; node:test observes module paths, not data reads, and the file was not declared, so the notice claimed "the same inputs" when the data had changed. The detection is right (the key did not move); the words overstated the evidence.

## Change

- `flakyText` reads `flaky: FAIL -> PASS under the same tracked inputs` (reports print it capitalized).
- `FLAKY_INPUTS_TEXT` (`flaky.ts`): ``A file a test reads that Squeal does not track can differ between the two runs; `inputs` in squeal.config.json declares such a file.`` Factual, not imperative (001 D6).
- A notice and Stop (`formatDelta`) print the pointer once, right after the first `Flaky:` line in print order: failures (a group block, row 011-109, is one place), then recoveries. `flakyLines()` (`src/core/delivery/failure-groups.ts`) returns a function that gives each block its flaky lines and the pointer only the first time; `formatDelta` makes one per notice and passes it to `entryBlock` and `groupLines`. A collapsed recovery list prints no note, as before.
- `squeal why` prints the pointer after the flaky line and its `the FAIL it replaced:` line, 4 spaces in.
- No key, store row, `meta` entry, detection rule or JSON field changes. `groupKey` still groups by the flaky text, so grouping is unchanged.

The coordinator approved the exact lines, the placement, the skill quote and the scheduler test changes (request `57122a8b`, 2026-10-26).

## Evidence

- `test/scheduler/flaky-inputs.test.ts`, real Vitest runs; the harness runner does not observe runtime reads, which stands in for node:test's unobserved data reads. The test file reads `data/durations.json` with `fs` and a marker outside the worktree. Its first run fails, its 001-171 re-run is held while one input changes, then runs:
  - undeclared data file changed: the key stays, a flaky note is recorded, the notice has the qualified line and the pointer once, and `why` has the same line and the pointer once;
  - the same file declared in `inputs`: the key moves, no note, neither `Flaky:` nor the pointer in the notice or `why`. A file re-keyed through a declared input alone is catch-up, which waits for quiet (row 011-153), so the test idles with `idleAfterQuiet`; plain `idle()` hung for 120 s;
  - the marker removed (a real same-key flip): the same notice and `why` lines as the undeclared case.
- `test/delivery/flaky-pointer.test.ts`: once per notice: after a group's note, not after a later single failure's or a recovery's; after the first of several flaky recoveries only; none without a note.
- `test/evals/grouped-failures.test.ts`: the parser gate round-trips the real `formatDelta` (plain text, a hook's context, a deny's reason) with a flaky group, then a single flaky failure, and a single flaky recovery with its retry line after the pointer. Before the parser change the group read the pointer as a fourth check (red at revision 14, three forms); `GROUP_FACT` in `evals/lib/squeal-text.mjs` now skips it.
- The old string's assertions moved to the new one in `test/scheduler/{inherited-failure,rerun-failure,retry-delivery}.test.ts`, `test/evals/retry-texts.ts` (with the pointer line, as the real notice now gives it), `test/evals/retry-claim.test.ts` and `test/harness/skill.test.ts`.

## Skill

The three `SKILL.md` copies quote the new line. The Claude Code copy has a 5,000-character budget (`skill.test.ts`); the eight added characters reached 5,000, so "a re-run that passes" reads "a passing re-run" in all three copies (4,996 now). The budget is nearly spent.

## Left for others

- `plugins/*/dist` hold the old text until the coordinator rebuilds at integration. The four bundle-drift tests (Claude Code, Codex, OpenCode, Pi) fail until then.
- 011 C5's wording ("Flaky: FAIL -> PASS under the same inputs") is the coordinator's to amend.
- Doc comments that say "the same inputs both failed and passed" stay in files outside this row: `src/core/delivery/attribution.ts:231`, `src/core/types/delivery.ts:120`, `src/core/types/state.ts:86`.
- `test/evals/transcripts/*` and `test/evals/fixtures/squeal-text-c6320866.mjs` are recorded history and keep the old line.
- Tracking node:test data reads, the other option of the human's card, is not done.

## Commits

- `f32a64550` feat(011-244): the note's words, the pointer, `why`, scheduler and delivery tests.
- `cc137d913` test(011-244): the evals parser and its gate, the evals texts.
- `bb54efa4f` docs(011-244): the skill quote, by agreement with the coordinator.
