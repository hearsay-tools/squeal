# 001-413 notes: repeated notes and the slow line's artifacts

Wave 15 W2. Commit: `3cd635d2`. Tests: `test/daemon/repeated-notes.test.ts`, `test/status/slow-artifact-count.test.ts`.

## What changed

- **Closure note topic.** node:test's incomplete-closure note carries the topic `node-test-closure:<project>`, so `readDaemonNotes` keeps the latest per project (007-39). The topic travels through these, each signature widened with an optional `topic` (additive):
  - `ProjectContext.note` (`adapter-project.ts`);
  - `NodeTestAdapterOptions.note` (`adapter.ts`);
  - `NodeTestRunnersOptions.note` (`node-test-runners.ts`);
  - the daemon's lambda, which passes it to `#note`.

  The store still keeps up to 3 notes per topic (`NOTES_PER_TOPIC`), as 007-39 decided.
- **Exit notes folded.** `squeal status` lists a daemon's exit notes (`exitOf` set) of one text once. It shows the latest, then `(N notes since <first>; \`squeal status --notes\` lists each)`. `--notes` lists each. Exit notes of different texts stay apart, so a failed start never hides behind a later idle stop. That is my reading of "the latest restart note": the brief's case is one text repeated. Folding all exit notes into one would lose a crash among idle stops.
- **Slow line.** It names one declared artifact and counts several: `current against 25 declared artifacts as of revision R`. With 25 artifacts the test's line is 122 characters; cezar's worst form (88 files, revision 79, "sources changed since") is 148. `status --json` already carried the list (`slowTier.artifact`). `status --notes` prints it under the slow line as `  Declared artifacts: a, b, ...`. The skill's `references/reports.md` (claude-code, codex, pi) says so.

## Decisions the brief did not settle

- **One artifact keeps its name.** "As a count" for one artifact would turn `current against dist/** as of revision 12` into `1 declared artifact`, which says less. It would also move the eval header pins (`test/evals/header-forms.test.ts`, `a8-load-hold.test.ts`), which are 006's. Several artifacts are counted.
- **Not touched:** the failure provenance line (`against dist/**, plugins/** as of revision 1`, `test/delivery/slow-provenance.test.ts`). It names a single failure's run, not the tier, so it is outside the slow line.

## Checks

- `repeated-notes.test.ts`: three daemon starts on a fixture with two node:test projects, each with a computed `import()`.
  - Expected: 2 closure notes, one per topic; 3 `daemon stopped: signal` notes in the store; one status line counting 3; three lines under `--notes`.
  - On `a439bbb9` it fails: 6 closure notes with no topic.
- `slow-artifact-count.test.ts`: 25 globs give a 122-character line. `--json` lists all 25, and `--notes` lists them under the line. One artifact is named, with no list. On `a439bbb9` the line joined all 25 names.
