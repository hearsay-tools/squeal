# 017-32 notes: the commit lint line names its tools and coverage

Worker 9a9f1052, wave 123 W4, 2026-11-19. Issues gh-237, gh-219, gh-170.

## What changed

- `src/core/commit/lint-tally.ts` (new): the pure tally (`LintView`, `CommitSide`, `lintCounts`, `lintTally`), moved out of `lint.ts` so that file stays under 300 lines. `lintTally` now also counts per tool: the files the commit changed that the tool has a check for, and their findings, not-determined and running counts.
- `src/core/commit/lint.ts`: `readLintCounts` and `commitLint` add `notRun` when no tool counted a file (`withNotRun`).
- `src/core/commit/report.ts`: `CommitLintCounts` gains `tools?` and `notRun?`; new `CommitLintToolCounts`; the stored-report parser reads both (`lintOf`).
- `src/core/commit/text.ts`: the lint part of the line, one part per tool.
- `plugins/{claude-code,codex-runtime,pi}/skills/squeal/references/reports.md`: the commit example and what the lint part means, byte for byte in the three copies. A test in `test/commit/text.test.ts` checks that each copy quotes the real formatter output. The Codex seed copy (`plugins/codex/seed/...`) already differed and was left alone.

The line, per tool that checked a changed file, sorted by tool name:

```text
lint (oxlint): 0 findings in 7 of 7 files
lint (oxlint): 3 findings in 7 of 7 files
lint (oxlint): 4 of 7 files still running, 0 findings in the other 3
lint (oxlint): 2 of 7 files not determined, 1 finding in the other 5
lint (oxlint): 2 of 7 files still running, 1 not determined, 0 findings in the other 4
lint (oxlint): 7 of 7 files still running
lint (eslint): 2 findings in 7 of 7 files; lint (oxlint): 1 of 7 files still running, 0 findings in the other 6
lint not run (off: <reason>)
lint not run (the lint pass has not listed the changed files yet)
lint not run (no changed file is linted)
```

## Decisions the brief did not settle

1. **Two tools: one part per tool**, separated by `; ` as the other parts are. Not a merged `lint (eslint, oxlint): …`: a file can be complete for one tool and running for the other, and a merged count would hide which.
2. **Incomplete wording.** The brief's example was `4 of 7 files still running, 0 findings so far`. I wrote `…, 0 findings in the other 3`: "so far" reads wrong when the open files are not determined (they will not run). Same facts. When no file is complete, the findings clause is left out.
3. **What "files" counts.** The files the commit changed and holds that the tool has a stored check for. A changed file with no check of that tool (a `.md` file, a file the pass has not listed yet) is not in the total. This is the existing evidence rule; this row only names it.
4. **`lint not run` reasons**, in this order: lint is off for its reason (`reasonsOf(...).off`, the status line's reason, so `off: ` leads it as `Lint: off: <reason>` does); no tool's pass has a cursor, or the commit released paths it waits for but no check of them is stored yet: `the lint pass has not listed the changed files yet`; otherwise `no changed file is linted` (a docs-only commit, for example).
5. **Reports stored before 017-32** have no `tools`; they keep their old line (`lint 1 finding, 1 file not determined, ...`). They are only shown for a commit made before the upgrade, and the newest commit replaces them.
6. **A tool that is off while another checked** is not named. The brief says the tool name is the scope; the part names the tool that checked.
7. **Released paths with no stored check.** Replaced by the review 0.1.570 B1 repair below: the first version left them out of the counts, which let a partial set read as complete.

## Review 0.1.570 B1 repair (commit 84d2726ad)

Finding: a current clean file plus a new failing file the lint pass had not listed yet gave `lint (eslint): 0 findings in 1 of 1 file`. The tally saw stored checks only.

Repair:

- `commitLint` takes `listedAt`, the revision of the commit's first report. For each tool whose pass has a cursor, is not off, and has keyed a revision below `listedAt`, every changed path the commit holds with no check of that tool is `unlisted` for it (`unlistedPaths`, `withUnlisted` in `lint-tally.ts`). This does not claim the path is lintable: the line says "not listed yet", not "running".
- The part then leads with them and calls the counts "listed files": `lint (eslint): 2 changed files not listed yet, 0 findings in 1 of 1 listed file`. A tool with only unlisted paths gets its own part: `lint (oxlint): 3 changed files not listed yet`.
- The report waits for the unlisted paths that do not differ from the commit, so `lintWaitEnded` holds the one update until the pass keys `listedAt`. The update reads them again: a lintable file now has a check and counts; a docs file has none and drops out (`no changed file is linted` when it was the only one).
- `src/core/scheduler/head-move.ts` (outside W4's files; agreed by coordinator 4abb5168 on 2026-11-19): `commitReport` passes `ledger.revision.number` for the first report, and `updateCommitReport` passes `newest.revision`, so edits made after the commit do not make the update read listed paths as unlisted.
- A tool whose pass never keyed (no cursor) still gets no part when another tool counted files. When no tool counted any file, the line stays `lint not run (the lint pass has not listed the changed files yet)`.
- `test/scheduler/commit-lint.test.ts` "a commit while an edit's tests run ...": its first line now reads `lint (eslint): 1 changed file not listed yet, 1 of 1 listed file still running`. The commit holds an edit of `src/a.ts` the pass had not listed. This is the B1 case, and the new line is the correct one. Its update is unchanged.

Tests added: the mixed regression through the real lint pass and store in `test/commit/lint.test.ts` (clean `a`, new failing `b` and a docs file: the first report, its waiting set, the wait not ended, then after listing the wait ends and the update reads `1 finding in 2 of 2 files`); a pure test with two tools at different progress; three text cases in `test/commit/text.test.ts`. The skill's `reports.md` (three copies) now also names "not listed yet".

## Type and JSON changes

Additive only:

- `CommitLintCounts.tools?: readonly CommitLintToolCounts[]` and `CommitLintCounts.notRun?: string`.
- New `CommitLintToolCounts { tool, files, findings, notDetermined, running, unlisted? }` (`unlisted` added by the B1 repair; absent when 0).
- `findings`, `notDetermined` and `running` at the top keep their meaning: counts of checks over all tools.

The stored report (`commit-reports` record) has no version field; the parser accepts reports with and without the new fields, and drops a malformed `tools` entry. Status JSON carries the commit line only as `commitLine.text`; it gains no field. **No report version moves.**

## Proposed spec amendment text

**017 D8**, a new item after "Status":

> - **Commit report** (amended 2026-11-19, row 017-32, the human: "Name tool + coverage"; gh-170, gh-219, gh-237). The lint part of a commit report (019 D5) names each tool that checked a file the commit changed and counts files: `lint (oxlint): 0 findings in 7 of 7 files`. The tool name is its scope; another lint command (ast-grep, a project's `lint` script) stays unsupported and is never implied. The finding count leads only when every file is complete; otherwise the files still running or not determined lead: `lint (oxlint): 4 of 7 files still running, 0 findings in the other 3`. While the tool's pass has not listed the revision of the commit's report, each changed file with no check of the tool leads as not listed yet, and the report's one update waits for the listing: `lint (eslint): 1 changed file not listed yet, 0 findings in 1 of 1 listed file` (review 0.1.570 B1). Two tools give two parts. When lint is on and no tool checked a changed file, the part says so with the reason: `lint not run (off: <reason>)`, `lint not run (the lint pass has not listed the changed files yet)` or `lint not run (no changed file is linted)`.

**019 D5 step 3**, replace the example and add one sentence:

> 3. **Report.** One line, ... for the newest commit: `Commit abc1234: 0 known failures; lint (oxlint): 2 findings in 7 of 7 files; 1 test file not determined (unstaged changes); 3 test files still running`. The lint part names its tools and counts files, and puts its findings first only on complete evidence (017 D8, amended 2026-11-19, row 017-32). When the commit groups finish, a change delivery updates it once.

**019 D6**: no wording change is needed in its items; the skill's `reports.md` carries the new example and the meaning of the lint part (done in this row).

## Checks run

- `pnpm run lint`: `Checked 3773 files in 2s. No fixes applied.`
- `pnpm run typecheck`: no errors.
- Direct runs during work: `test/commit/text.test.ts` 22 passed; `test/commit/lint.test.ts` 14 passed; `test/scheduler/commit-lint.test.ts` and `test/scheduler/commit-report.test.ts` 17 passed.
- `test/e2e/run-triggers.test.ts` (outside Squeal's coverage) reads the committed plugin bundle. In this worktree, without a build (brief rule), it fails 2 of 2 with the old line, as expected. In a scratch copy of commit 440cd487 under the task scratch folder, built with `pnpm run build`, it passed 2 of 2 (192 s). The scratch copy was deleted. The coordinator's build makes it pass here.
- `squeal status --wait`: see the end of this file.

## Squeal status evidence

`report.ts` and `text.ts` are read by most status code, so the 11 changed paths select 1,074 test files. Three waits ran on the 11 paths (`squeal status --wait 60000`, then `300000`, `540000` and `600000`), at revision 16 to 17 (commit 440cd487 plus this notes file). The last one, at about 15:20 UTC:

- Current: 211 pass, among them `test/commit/lint.test.ts`, `test/commit/text.test.ts`, `test/scheduler/commit-lint.test.ts`, `test/scheduler/commit-report.test.ts`, `test/commit/stored-stall.test.ts`.
- Pending: 863, queued and waiting for CPU ("the host is busy (14 of 24 cores in use)"). Known failures 0.
- No verdict: the deadline passed. These 863 files are **not verified** by Squeal at the time of this note.

To cover the files that read the commit line or the skill reports, I ran these directly (`timeout 900 pnpm exec vitest run --maxWorkers=2 ...`): `test/cli/kept-header`, `test/commit/stop-told-daemon`, `test/commit/stored-stall`, `test/delivery/commit-update`, `test/delivery/group-told`, `test/delivery/titles`, `test/evals/own-count`, `test/harness/shared/skill-pytest`, `test/harness/skill-groups`, `test/harness/skill`, `test/status/group-lines`: 11 files, 69 tests passed.

### B1 repair checks (2026-11-19, about 16:40 UTC)

- `pnpm run lint`: `Checked 3801 files in 2s. No fixes applied.` `pnpm run typecheck`: no errors.
- Direct: `test/commit/**`, `test/scheduler/commit-lint`, `test/scheduler/commit-report`, `test/delivery/{commit-update,group-told,titles}`, `test/cli/kept-header`, `test/status/group-lines`, `test/harness/{skill,skill-groups}`: 25 files, 186 of 187 passed with `--maxWorkers=3` at host load 31. The one failure, `test/commit/boundary-daemon.test.ts` (no lint in it), timed out under load and passed twice alone.
- `test/e2e/run-triggers.test.ts` on a scratch build of 84d2726ad: 2 of 2 passed. The scratch copy is in the task scratch folder (`t/9a9f1052/e2e`); deleting it needed an approval I could not get, so it is removed with the worktree.
- `squeal status --wait 540000` on the changed paths: 180 pass. 1 fails: `test/harness/plugin.test.ts > bundles > are committed exactly as npm run build produces them` (`cli/squeal.mjs differs from the build`), expected drift: the candidate commits the bundles and the brief forbids a build here. 905 are queued with no verdict: the daemon stopped at 15:39:52 UTC.

