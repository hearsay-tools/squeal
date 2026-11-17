# 005-94: the texts before any code

Researcher's file for row 005-94 (wave 16, W2), 2026-11-17. It shows each sentence that the wording pass changes, before and after, for the human to approve. Nothing here is built. The coordinator writes the brief for the code from the approved texts.

- Base: `main` at `9967ce790` (Squeal 0.1.531). W1's carried texts (row 005-93, part 1) are read on `origin/wip/005-93` at `88ad9a358`.
- "Before" texts: printed by the real formatters of the base commit (`formatRegistration`, `headerLines`, `primer`, `statusText`, `formatDelta`, `sawEditLine`). The throwaway probe is `probe/render.ts` (see `probe/README.md`). The status values are hand-set (`StatusHeader` objects); the words are the code's. The clock is in UTC.
- "After" texts of the primer: printed by a draft copy of `primer.ts` (`probe/primer-after.ts`, run by `probe/after.ts`), which keeps the fold and drop logic. The lengths are measured, not estimated. All other "after" texts are hand-written proposals.
- Coverages. **Default**: this repository (Vitest with `vitest.config.ts`, `test/e2e/**` excluded, no slow files, no check groups). **Cezar**: Vitest and two node:test projects, check groups `lint` and `tests` at edit, `run-loop` at pause, `browser` manual, slow declared with 0 files (`test/harness/primer-over-cap.test.ts`; its runner part matches `runnerCoverage` read from cezar's `squeal.config.json` at `fd1e7f658`). **Slow-on**: the default with 3 slow files and `stop.requireSlowSuite` on. The eval fixture (`evals/ledgerline`) is measured too, because the atomic tier reads its primer.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Registration | Drop the checkpoint, Inherited, Imported, test-files-without-checks sentences and the commit suffix. One `Known failures` line counts test files and defines "current" in place. | before: verified by experiment; after: proposal |
| 2 | Primer | The path wait fits every measured primer when "or a checkpoint, `squeal run --all --wait`" leaves it and the 005-89 drop order runs before the plain wait. New recovery and hand-run clauses. All at most 1,473 characters under `squeal`. | verified by experiment (draft copy) |
| 3 | Stop with no results | No `Known failures: 0` line while unlisted; no "results are as of revision 0" while no result exists. | before: verified by experiment |
| 4 | Late feed | The clock names UTC; a second sentence gives the path wait, which asks Squeal to read the edits. | before: verified by experiment; wait behaviour: read in source code |
| 5 | Four words | "closure" is in no hook text since 005-92. "re-keyed" leaves the hooks with W1. "lookup-only" and "test files without checks" leave with item 1. The skill still says all of them. | read in source code |
| 6 | Skill | Eight sentences in `SKILL.md` and `references/reports.md` change; two already contradict main (005-90, 005-92). | read in source code |
| 7 | Eval | All 11 atomic cells read the primer and the registration. a3, a4, a6 and a7 read the changed clauses most directly. The unlisted and late texts appear in no atomic cell. | read in source code, inferred |

## 1. The registration

The rule (`status.md`, 2026-11-16): a hook sentence stays when the agent in the session can act on it. Sorted by the research file's table (`research/hook-messages-2026-11-16.md`, "The test for each sentence").

### Before, default coverage (663 characters)

```text
SQUEAL · registered at revision 79
Revision 79 · a8f6984d + 3, dirty: 4400 current (3932 tests, 468 test files loaded), 120 pending (108 tests, 12 test files loaded), 0 stale, 36 unknown (32 tests, 4 test files loaded). Inherited: 4100 of 4400 current (3660 tests, 440 test files loaded). Imported: 12 of 4400 current. Test files without checks: 0 pending, 100 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 79; `squeal run --all` requests one).
Known failures: 0; not current: 116 of 584 test files (12 queued, 104 unknown), 140 tests (108 queued, 32 unknown)
Complexity: 74 functions over 20; squeal code lists them.
```

### Before, cezar (921)

```text
SQUEAL · registered at revision 79
Revision 79 · a8f6984d + 3, dirty: 4400 current (3932 tests, 468 test files loaded), 120 pending (108 tests, 12 test files loaded), 0 stale, 36 unknown (32 tests, 4 test files loaded). Inherited: 4100 of 4400 current (3660 tests, 440 test files loaded). Test files without checks: 0 pending, 100 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 79; `squeal run --all` requests one).
Slow tier: no slow test files listed yet; Squeal runs them after the fast tests.
browser: 9 test files; 9 not run at revision 79. Squeal has not queued them; `squeal run browser --wait 60000` runs them now and waits for their results.
Known failures: 0; not current: 116 of 584 test files (12 queued, 104 unknown), 140 tests (108 queued, 32 unknown)
Complexity: 74 functions over 20; squeal code lists them.
Lint: 2 files with findings; squeal lint lists them.
```

### Before, slow-on (825)

```text
SQUEAL · registered at revision 79
Revision 79 · a8f6984d + 3, dirty: 4400 current (3932 tests, 468 test files loaded), 120 pending (108 tests, 12 test files loaded), 0 stale, 36 unknown (32 tests, 4 test files loaded). Inherited: 4100 of 4400 current (3660 tests, 440 test files loaded). Test files without checks: 0 pending, 100 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 79; `squeal run --all` requests one).
Slow tier: 3 test files; 1 current at revision 75; 2 not run at revision 79. Stop waits up to 2 min for them or holds the agent once; `squeal run --slow --wait 60000` waits for their results.
Known failures: 0; not current: 116 of 584 test files (12 queued, 104 unknown), 140 tests (108 queued, 32 unknown)
Complexity: 74 functions over 20; squeal code lists them.
```

### Before, every test file current

```text
SQUEAL · registered at revision 79
Revision 79 · a8f6984d + 3, dirty: 4556 current (4072 tests, 484 test files loaded), 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 79.
Known failures: 0; all 484 test files current
Complexity: 74 functions over 20; squeal code lists them.
```

### After (proposal R1)

The registration's counts line goes. The `Known failures` line comes first and says how far its zero reaches, in test files, with "current" defined in place. Pending, stale and unknown are not counted in the hook; `squeal status` counts them.

Default:

```text
SQUEAL · registered at revision 79
Known failures: 0; 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.
Complexity: 74 functions over 20; squeal code lists them.
```

Cezar:

```text
SQUEAL · registered at revision 79
Known failures: 0; 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.
browser: 9 test files; 9 not run at revision 79. Squeal has not queued them; `squeal run browser --wait 60000` runs them now and waits for their results.
Complexity: 74 functions over 20; squeal code lists them.
Lint: 2 files with findings; squeal lint lists them.
```

Slow-on:

```text
SQUEAL · registered at revision 79
Known failures: 0; 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.
Slow tier: 3 test files; 1 current at revision 75; 2 not run at revision 79. Stop waits up to 2 min for them or holds the agent once; `squeal run --slow --wait 60000` waits for their results.
Complexity: 74 functions over 20; squeal code lists them.
```

Every test file current: `Known failures: 0; all 484 test files are current (run on the files as they are now).`

With failures: `` Known failures: 2 (2 tests); 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest. ``, then the failure blocks as today.

A `Revision 79 …` line stays only when it has something to say: changed paths, a delay sentence, a daemon, install or hold sentence. Without one, the title already names the revision.

### After, alternative R2 (keeps the worktree's counts, defined)

```text
SQUEAL · registered at revision 79
Revision 79: 468 of 584 test files are current (run on the files as they are now), 12 pending (queued or running), 104 unknown (no result).
Known failures: 0
```

A stale count reads `3 stale (run on older file contents; not queued)`. R2 keeps the whole worktree's queue in the hook, which the table puts in the person's column; R1 does not.

### The changes

| Sentence | Change | Finding | For | Where the fact stays |
|---|---|---|---|---|
| `Full-suite checkpoint: none completed …` | removed | 3 | person | `squeal status` (default text, verified by experiment on 0.1.526) |
| `Inherited: 4100 of 4400 current …` | removed | 3 | person | `squeal status --full`: `Inherited from other worktrees: …` and one line per source (verified by experiment) |
| `Imported: 12 of 4400 current.` | removed | 3 | person | `squeal status --full`: `importLines` (read in source code, `src/core/status/import-lines.ts`) |
| `4400 current (3932 tests, 468 test files loaded), 120 pending (…), 0 stale, 36 unknown (…)` | removed (R1) or test files with glosses (R2) | 4, 8 | person (R1) | `squeal status`: `Affected checks:` and `Known failures:` lines |
| `Test files without checks: 0 pending, 100 unknown.` | removed; the files count among the test files of the `Known failures` line | 4 | person | `squeal status --full` (`status-detail.ts`, printed when not 0) |
| `Known failures: 0; not current: 116 of 584 test files (12 queued, 104 unknown), 140 tests (…)` | `` Known failures: 0; 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest. `` | 4 | agent | the tests split: `squeal status` |
| `Revision 79 · a8f6984d + 3, dirty` | `Revision 79`, here and in every hook header | 4 | person | `squeal status`: `Revision: 79 · a8f6984d + 3, dirty`; `--full`: `Worktree: … (HEAD …, dirty at revision N)` (verified by experiment) |
| `Slow tier: no slow test files listed yet; Squeal runs them after the fast tests.` (0 slow files listed) | removed from hooks while the listing counts 0 | 1 (the primer's own drop) | person | `squeal status` |
| `Complexity: counting has not started.`, `Complexity: counting, N of M files.` and lint's linting progress | removed from hooks; the count line stays once known | table, "counting progress" | person | `squeal status` |

Not changed: the group lines, the slow-tier line with files, the complexity and lint counts, the daemon, install, hold and delay sentences, `earlierFailuresLines`, the failure blocks.

### The owed counts (first delivery after the listing, row 011-205)

Before (413):

```text
SQUEAL · the counts after the listing at revision 79
Revision 79 · a8f6984d + 3, dirty: 4400 current (3932 tests, 468 test files loaded), 120 pending (108 tests, 12 test files loaded), 0 stale, 36 unknown (32 tests, 4 test files loaded). Inherited: 4100 of 4400 current (3660 tests, 440 test files loaded). Test files without checks: 0 pending, 100 unknown; the baseline is lookup-only, so it queued none of them.
```

After: the title loses the internal word "listing", the line is R1's.

```text
SQUEAL · first results in this worktree at revision 79
Known failures: 0; 468 of 584 test files are current (run on the files as they are now), and `squeal status` counts the rest.
```

The title words come from `src/core/delivery/content-title.ts`, which W1 owns in wave 16.

## 2. The primer

### Lengths (characters, cap `PRIMER_CAP_CHARS` 1,500)

| Coverage | `squeal` before | `squeal` after | Codex before | Codex after | Path wait before → after | Dropped after (Codex) |
|---|---|---|---|---|---|---|
| default | 1109 | 1100 | 1221 | 1209 | yes → yes | none |
| cezar | 1444 | 1435 | 1470 | 1458 | yes → yes | none |
| slow-on | 1460 | 1424 | 1457 | 1415 | **no → yes** | slow arrival (Codex: slow arrival and retry) |
| eval fixture | 1482 | 1473 | 1423 | 1458 | yes → yes (Codex no → yes) | none (Codex: slow arrival) |
| eval fixture, a8 | 1477 | 1468 | 1418 | 1453 | yes → yes (Codex no → yes) | none (Codex: slow arrival) |
| no test group at edit | 1385 | 1356 | 1411 | 1471 | yes → yes | none |

The Codex CLI is a 109-character path in the probe (`~/.codex/plugins/cache/squeal/squeal/0.1.531/…`). A real path is longer (217 characters in task 004-78), so a real Codex primer drops more, in the 005-89 order.

The rule change that gives every measured primer the path wait: try the path wait before the plain wait, with the 005-89 drop sets (both slow sentences at 0 slow files, else the slow arrival sentence; then the retry; then "Run tests yourself"; then the revision definition). Today the path wait is tried only when the plain wait is over the cap (005-89's accepted deviation leaves this to 005-94).

### Before, default (1109)

```text
Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed; before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: `squeal retry <file> --reason load|environment`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest (vitest.config.ts). Squeal does not cover typecheck, build, the Vitest test files matching "test/e2e/**", which squeal.config.json excludes, or any other test suite: run those yourself.
```

### After, default (1100)

```text
Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed; passes stay silent unless they follow a failure, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed, and `squeal status --wait 60000` before you finish. Run tests yourself only when no daemon is validating, when Squeal's run left a result unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: `squeal retry <file> --reason load|environment`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest (vitest.config.ts). Squeal does not cover typecheck, build, the Vitest test files matching "test/e2e/**", which squeal.config.json excludes, or any other test suite: run those yourself.
```

### Before, cezar (1444)

```text
Squeal runs this repository's Vitest and node:test tests in the background; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest or node:test to learn whether your edits broke something. Check groups: lint and tests (the test files no group selects) after each edit; run-loop between your turns; browser waits for `squeal run browser`; `squeal run <group> --wait 60000` runs one now. Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed; before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: `squeal retry <file> --reason load|environment`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest and node:test projects "test:unit" (packages/cezar/test/unit/*.test.ts) and "root:test:unit" (.github/scripts/*.test.cjs, scripts/*.test.mjs, .ai/skills/*/scripts/*.test.mjs), with 0 slow test files at the daemon's last listing. Squeal does not cover typecheck, build or any other test suite: run those yourself.
```

### After, cezar (1435)

```text
Squeal runs this repository's Vitest and node:test tests in the background; a SQUEAL message with your next tool call means a check changed; passes stay silent unless they follow a failure, so keep working; do not run Vitest or node:test to learn whether your edits broke something. Check groups: lint and tests (the test files no group selects) after each edit; run-loop between your turns; browser waits for `squeal run browser`; `squeal run <group> --wait 60000` runs one now. Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed, and `squeal status --wait 60000` before you finish. Run tests yourself only when no daemon is validating, when Squeal's run left a result unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: `squeal retry <file> --reason load|environment`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest and node:test projects "test:unit" (packages/cezar/test/unit/*.test.ts) and "root:test:unit" (.github/scripts/*.test.cjs, scripts/*.test.mjs, .ai/skills/*/scripts/*.test.mjs), with 0 slow test files at the daemon's last listing. Squeal does not cover typecheck, build or any other test suite: run those yourself.
```

### Before, slow-on (1460)

```text
Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step, for example before saying the task is done: `squeal status --wait 60000`. Slow test files run after the fast tests; this repository requires them once you change a file: before you say the task is done, wait with `squeal run --slow --wait 60000` unless the latest `Slow tier:` line says every slow file is current; Stop waits or holds you once. A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call. Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: `squeal retry <file> --reason load|environment`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest (vitest.config.ts), with 3 slow test files at the daemon's last listing. Squeal does not cover typecheck, build, the Vitest test files matching "test/e2e/**", which squeal.config.json excludes, or any other test suite: run those yourself.
```

### After, slow-on (1424)

```text
Squeal runs this repository's Vitest tests in the background after each edit; a SQUEAL message with your next tool call means a check changed; passes stay silent unless they follow a failure, so keep working; do not run Vitest to learn whether your edits broke something. Wait only when you need a result before your next step: `squeal status --wait 60000 <path>...` for the verdict on files you just changed, and `squeal status --wait 60000` before you finish. Slow test files run after the fast tests; this repository requires them once you change a file: before you say the task is done, wait with `squeal run --slow --wait 60000` unless the latest `Slow tier:` line says every slow file is current; Stop waits or holds you once. Run tests yourself only when no daemon is validating, when Squeal's run left a result unknown, or when the repository's own gate requires it. For a failure from load or a stopped service: `squeal retry <file> --reason load|environment`, never past a real one. A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed. Squeal covers Vitest (vitest.config.ts), with 3 slow test files at the daemon's last listing. Squeal does not cover typecheck, build, the Vitest test files matching "test/e2e/**", which squeal.config.json excludes, or any other test suite: run those yourself.
```

### The changes

| Before | After | Finding | For |
|---|---|---|---|
| `a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working;` | `a SQUEAL message with your next tool call means a check changed; passes stay silent unless they follow a failure, so keep working;` | 13 (426 `FAIL -> PASS` messages beside "passing results stay silent") | agent |
| `` … for the verdict on files you just changed; before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`. `` | `` … for the verdict on files you just changed, and `squeal status --wait 60000` before you finish. `` | 1, 3; D6 | agent; the checkpoint stays in skill step 3 |
| Slow-on: `` Wait only when you need a result before your next step, for example before saying the task is done: `squeal status --wait 60000`. `` | the path wait above; the slow arrival sentence leaves (005-89's order) | 1; 005-89 deviation | agent |
| `Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.` | `Run tests yourself only when no daemon is validating, when Squeal's run left a result unknown, or when the repository's own gate requires it.` | 2 (84 of 254 hand runs followed "has not listed") | agent |
| No test group at edit: `` …: `squeal run <group> <path>... --wait 60000`; before you finish, `squeal status --wait 60000` or a checkpoint, `squeal run --all --wait`. `` | `` …: `squeal run <group> <path>... --wait 60000`; `squeal status --wait 60000` before you finish. `` | 3 | agent |

The same recovery clause goes into the first-edit line and W1's done form (see 5) and into 005-97's late text (`origin/wip/005-93`, `lateLine`: "Passing results stay silent;").

## 3. Stop with no results yet

Before (306):

```text
SQUEAL · status at revision 0
Revision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change. A daemon is starting; results are as of revision 0.
Known failures: 0; the daemon has not listed this worktree's test files yet
```

After:

```text
SQUEAL · status at revision 0
Revision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change.
```

The registration while unlisted, before (272):

```text
SQUEAL · registered at revision 0
Revision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change. A daemon is starting; results are as of revision 0.
Complexity: counting has not started.
```

After: the same two lines without `A daemon is starting; results are as of revision 0.` and without `Complexity: counting has not started.` (item 1).

Two changes to Stop, for the agent (finding 2): no `Known failures` line while the test files are not listed and none failed (the rule 005-90 gave the registration, `knownFailuresLines` in `format.ts`; Stop's `knownFailuresLine` in `text.ts` prints it always); no `A daemon is starting; results are as of revision 0.`, since no result exists. The registration's unlisted form loses the same sentence. `squeal status` keeps both lines.

The unlisted form with no daemon says two things that conflict ("still starting", "No daemon is running"):

```text
SQUEAL · registered at revision 0
Revision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change. No daemon is running; results are as of revision 0.
```

After: `` Revision 0: Squeal has no results in this worktree yet, and no daemon is running; `squeal start` starts one. ``

Also in Stop's full header (listed): every change of item 1 applies, if Stop takes the registration's form (open choice C2).

## 4. The late-feed sentence

Before, a delivery's header (260); the feed is late when its last batch started over 60 s ago (`FEED_LATE_MS`, 2 × 30 s):

```text
Revision 79 · a8f6984d + 3, dirty: 120 pending (108 tests, 12 test files loaded), 36 unknown (32 tests, 4 test files loaded). Test files without checks: 100 unknown. Squeal has not yet read edits made after 01:16:30; these counts cover revision 79 and earlier.
```

With the revision's listing pending too:

```text
Revision 79 · a8f6984d + 3, dirty: 120 pending (108 tests, 12 test files loaded), 36 unknown (32 tests, 4 test files loaded). Test files without checks: 100 unknown. Squeal is behind: it has not read edits made after 01:16:30, and Vitest has not listed revision 79's test files yet, so new test files are not counted.
```

After (W1's own count in place of the queue counts; the commit suffix gone):

```text
Revision 79: the 9 test files your edits affect have all run. Squeal has not yet read edits made after 01:16:30 UTC; these results cover revision 79 and earlier. `squeal status --wait 60000 <path>...` asks it to read them and waits for the files your paths select.
```

```text
Squeal is behind: it has not read edits made after 01:16:30 UTC, and Vitest has not listed revision 79's test files yet, so new test files are not counted. `squeal status --wait 60000 <path>...` asks it to read them and waits for the files your paths select.
```

- The zone (finding 13). `timeText` (`src/core/text.ts`) prints the process's local clock with no zone. The heartbeat text prints ISO UTC (`lateHeartbeatDetail`). The proposal prints the clock in UTC with "UTC". Options in C4.
- The next step (finding 13). `status --wait` asks the daemon for a reconciliation pass at its start and decides quiet only at the revision that pass left (`src/cli/status-wait.ts`, doc comment of `statusWaitCommand`; `src/cli/status-sync.ts`), so "asks it to read them" is what the code does. Read in source code, not run.
- W1 drops this sentence from the news line while files of the agent's own edits are owed (`newsLine` on `origin/wip/005-93`); it stays in the full form, in `squeal status`, and in the news line once the owed count is 0.

## 5. The four words

| Word | Where a hook says it on main | Proposal | For |
|---|---|---|---|
| re-keyed | `sawEditLine` with no test group at edit: `Squeal saw your edit, which re-keyed 9 test files; …`; `settledLine`: `All 2 test files your edits since revision 4 re-keyed are current.`; `sawSettledLine`: `Squeal saw your edit; all 2 test files it re-keyed are current, and passing results stay silent.` | W1 already gives "affects" and removes both settled lines (`origin/wip/005-93`). 005-94 adds nothing in hooks. Outside hooks: `status --wait` prints "the edits since revision N re-keyed" (`src/cli/status-wait-lines.ts`) and skill step 3 says "re-keyed": both become "affect" (open choice C6). | agent |
| closure | none since row 005-92 ("imports" in place of "closure", `src/core/delivery/provenance.ts`). Left in the CLI (`no test file's closure holds <path>`), a status note (`refusedNote`) and the code gate. | No hook change. The skill's `reports.md` says "which its closure rarely holds": becomes "which its imports rarely include". | agent (skill) |
| lookup-only | the owed counts: `…; the baseline is lookup-only, so it queued none of them.` | Removed with the test-files-without-checks sentence (item 1). `squeal status` keeps `(the baseline is lookup-only)` in `Outstanding` (verified by experiment). | person |
| test files without checks | the full header (registration, Stop, owed counts); the news line on main | Removed from hooks (item 1; W1 removes it from the news line). `squeal status --full` keeps it. | person |
| `· a8f6984d + 3, dirty` | every hook header's revision | Removed from hooks; `squeal status` keeps it, `--full` explains it (item 1). | person |
| current, pending, stale, unknown | every full header and `Known failures` line | R1: "current" defined in place, the others left to `squeal status`. R2: each glossed in place. | agent |

The first-edit and done lines with the recovery clause (W1's texts on the left):

| W1 (`origin/wip/005-93`) | After |
|---|---|
| `Squeal saw your edit and queued 9 test files; results arrive with later tool calls, and passing ones stay silent.` | `Squeal saw your edit and queued 9 test files; results arrive with later tool calls, and passes stay silent unless they follow a failure.` |
| `Squeal saw your edit; passing results stay silent.` | `Squeal saw your edit; passes stay silent unless they follow a failure.` |

## 6. The skill

Quoted from `plugins/claude-code/skills/squeal/`. The `codex-runtime` and `pi` copies carry the same sentences (pi adds its command paragraph). `plugins/codex/seed` is the frozen seed (spec 002 D7) and is not changed.

| Where | Before | After |
|---|---|---|
| `SKILL.md`, "Reading a header" | `` The registration and Stop's report start with a header like `Revision 21 (changed src/math.ts): 40 current (34 tests, 6 test files loaded), 3 pending (3 tests), 0 stale, 0 unknown.`, naming the files changed since your last report: … Other SQUEAL messages carry the news, those files and non-zero counts only. `` | `` The registration and Stop's report say `Known failures: 0; 40 of 43 test files are current (run on the files as they are now), and squeal status counts the rest.`, after a line naming the files changed since your last report: … Other SQUEAL messages carry those files and how many of the test files your edits affect have not run yet; `squeal status` has every count. `` |
| `SKILL.md`, step 3 | `it returns once the test files your edits re-keyed have results` | `it returns once the test files your edits affect have results` |
| `SKILL.md`, step 4 | `` `Known failures: 0; not current: …` means "no known failures yet". `` | `` `Known failures: 0` beside test files that are not current means "no known failures yet". `` |
| `SKILL.md`, step 5 | `when a header says no daemon is validating, a result is unknown, or …` | `` when a header says no daemon is validating, Squeal's run left a result unknown, or …; while Squeal is still starting, wait with `squeal status --wait 60000 <path>...` instead `` |
| `reports.md`, "The header" | the full header example, the Inherited item, the Full-suite checkpoint item, the Test files without checks item | the R1 line as the hook's form; the three items move under "`squeal status` also prints" |
| `reports.md`, item | `**The daemon has not listed this worktree's test files yet**: nothing has been looked at, so zero counts are not complete.` | `` **Squeal is still starting in this worktree and has no results yet**: it has looked at nothing; `squeal status --wait 60000 <path>...` waits for the files you change. `` (main prints this since 005-90; the skill lags) |
| `reports.md`, item | `**Squeal has not yet read edits made after 14:02:10; these counts cover revision N and earlier**: …` | the UTC form and its wait (item 4) |
| `reports.md`, "Reading a failure" | `touches files changed here since this session started: src/auth.ts` | `its imports include files changed here since this session started: src/auth.ts` (main prints this since 005-92; the skill lags) |

## What an atomic eval run must show

No eval was run. Every atomic cell starts warm on `evals/ledgerline` (`evals/atomic/atomic.json`, description), so each reads the primer and a listed registration. The unlisted texts (3) and the late feed (4) appear in no atomic cell: their proof is unit and e2e tests. Inferred from the scenario knobs.

| Cell | Measures | The change it reads |
|---|---|---|
| a3-harmless | `current-before-claim`, `no-rerun-answered` | the recovery clause; the R1 line |
| a4-pending | `no-claim-on-pending`, `no-sleep` | the path wait; "passes stay silent unless …" |
| a6-daemon-down | `own-run-covers`, `no-false-pass` | "Run tests yourself only when no daemon is validating …" (unchanged clause) beside the new unknown clause |
| a7-stale | `current-before-claim` | R1 drops any stale or pending count from the registration; R2 and main show it |
| a2-slow, a8-load-hold | `slow-through-squeal` | the eval fixture's primer: under Codex the slow arrival sentence leaves for the path wait |
| a5-uncovered | `own-run-covers` | the not-covered sentence (unchanged) |
| a1, a9, a10, a11 | `claim-true`, retry measures | the retry sentence (kept under `squeal`; kept in the eval fixture under Codex) |

The run, once the code lands: the atomic tier on Sonnet and Sol on the candidate, no new flag against the last atomic run (`20261101T080144Z-c020b2`, 0.1.387), and no alarm. The evals parser gate must read the new forms before the run: `evals/lib/squeal-text.mjs` finds counts with `/^Known failures: (\d+)/m` and the header regex (lines 298 to 387). Under R1 a registration has no pending, stale or unknown counts, so the parser reads "all N test files are current" as nothing pending, stale or unknown and "X of N test files are current" as not settled. a7 is the cell that would show R1's cost.

## Decided (the human, 2026-11-17)

- C1: R1, the registration without worktree counts.
- C2: (a), Stop takes the registration's form.
- C3: (a), no checkpoint clause in the primer's wait.
- C4: (a), UTC, named.
- C5: (a), no slow-tier line at 0 slow files.
- C6: yes, `status --wait`'s "re-keyed" line changes too.
- C7: the revision definition is unchanged.

## Open choices (as asked; answers above)

- **C1. The registration's counts.** R1 (recommended): no worktree counts; the `Known failures` line says how many test files are current. R2: the worktree's test-file counts with a gloss each. R1 follows the human's table; R2 keeps a stale or pending start visible in the hook.
- **C2. Stop's header.** (a, recommended) Stop takes the registration's form; only `squeal status` keeps the full header. (b) Stop keeps today's full header. Stop is a hook; the agent reads it before a claim.
- **C3. The checkpoint in the primer's wait.** (a, recommended) Leave it out: the eval fixture's `squeal` primers keep the slow arrival sentence (1,473 and 1,468 characters). (b) Keep it: then they drop it (1,390 and 1,385 characters, measured with `PRIMER_CHECKPOINT=1`), and spec D6's wait sentence is unchanged. The slow-on primer drops the slow arrival sentence in both.
- **C4. The late-feed clock.** (a, recommended) UTC, with "UTC". (b) The host's local zone, named (for example "CET"). (c) An age, "edits of the last 74 s", with no clock. (a) and (b) also change `squeal status`, which prints the same sentence.
- **C5. The slow tier at 0 files.** (a, recommended) No line in hooks. (b) Keep it.
- **C6. Outside hooks.** Whether this row also changes `status --wait`'s "re-keyed" line (the agent reads it, but it is not a hook).
- **C7. The revision definition.** Not changed here. Shortening it (it is the human's wording, 2026-10-10) would leave room for a long real Codex path, which drops the retry sentence first (not measured).

## What the code must also change

- Spec 005 D1 says "the registration, Stop and `status` print all four and the checkpoint": amend for the registration (and Stop, with C2 (a)).
- Spec 005 D6: the primer's wait sentence (with C3 (a)); the recovery clause.
- 001 D6 and D7 own the header forms: the `· sha + N, dirty` suffix in hooks (task 001-406) and the full form.
- Tests named in the row: primer, registration and skill-copy tests; `test/harness/primer-over-cap.test.ts` pins the 005-89 drop order and the "fits today, unchanged" rule, which this pass replaces; the four e2e text files (`status.md`, 2026-11-17, lessons).

## Sources

- `research/hook-messages-2026-11-16.md` (findings 1 to 4, 8, 13 and the table); `status.md` 2026-11-16 and 2026-11-17; `docs/vision.md` principle 1; spec 005 D1, D6.
- `src/harness/shared/primer.ts`, `text.ts`, `stop-text.ts`; `src/core/delivery/format.ts`, `header.ts`, `provenance.ts`, `content-title.ts`; `src/core/status/feed-late.ts`, `format-status.ts`, `status-detail.ts`; `src/core/state/header.ts` (`fullSuiteText`), `revision-commit.ts`; `src/cli/status-wait.ts`, `status-sync.ts`, `status-wait-ask.ts`; at `9967ce790`.
- `origin/wip/005-93` at `88ad9a358`: `src/core/delivery/late-format.ts`, `format.ts`, `header.ts`.
- `plugins/{claude-code,codex-runtime,pi}/skills/squeal/SKILL.md` and `references/reports.md`.
- `evals/atomic/atomic.json`, `evals/lib/atomic-measures.mjs`, `evals/lib/squeal-text.mjs`, `evals/results/ATOMIC.md`, `evals/ledgerline/squeal.config.json`.
- Experiment: `squeal status --full` (installed 0.1.526) in this worktree, read-only, for where the removed facts stay.
- Probes: `probe/render.ts`, `probe/after.ts`, `probe/primer-after.ts`.
