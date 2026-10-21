# 011-64: past failures by test file and check, and a replaced failure kept, a design for the human

Board row 011-64, a docs-only design draft (brief W6 of `../wave-8.md`). Approved by the human on 2026-10-21 as the design row for triage round 9, group D: gh-67 (find a test file's stored failures, and its test-file frame) with gh-54 (keep the failure a passing retry replaced). Nothing here is in `spec.md` until the human accepts it. On acceptance, the three amendments in "Spec text" go into 011 C5, C6 and C7, `status.md` gets a dated line, and the code rows of section 5 are numbered on the board.

Sources: `research/issue-67.md`, `research/issue-54.md` and their probes; 011 C5, C6, C7 and `status.md` (the 011-37 and 011-41 lines); row 011-50; the source at `775dfe14f`. New evidence: `probes/` (method and isolation in `probes/README.md`, the recorded run in `probes/output.txt`). The SQL probes read a read-only copy of cezar's store taken at 2026-10-21T15:09Z: 660,622 results, 1,065 of them failing, 22,750 checks, 944 test files, 32 worktrees, 6,493 runs, 404 failure texts. Host: 24 CPUs; the one-minute load was 39.6 when the session started, 33.7 at the copy and 10.6 to 11.5 during the recorded run. Timings are medians of 7.

Evidence tags: *verified by experiment* (a probe in `probes/`), *measured on cezar's store* (read-only copy), *read in source code* (at `775dfe14f`), *inferred*.

## Summary

- `squeal failures` takes test files or directories as arguments, `--check <text>` and `--limit <n>`. The selection and the limit are applied in SQL. The query names the existing index `results_by_failure`; on cezar its column, `failure_id`, is set only on failing rows. No new index, no schema migration. On cezar's store, today's list and count take 72 ms and 90 ms; the indexed forms take 1.0 ms and 0.7 ms, and a test-file filter takes 4.5 ms.
- A failure whose `location` is a helper also names the first frame in the check's own test file: `at <helper>, called from <test file>:<line>:<column>`. The frame is read from the stored stack when it is shown. It is not stored, and `location`, the fingerprint and every key stay as they are. On cezar, 91 of 403 test-level failures (23 %) name a helper; the stack holds the test-file frame for 60 of the 91. The stack text's positions equal `location`'s in all 477 failures checked.
- A failing row that a pass replaces at the same key is kept as a **replaced failure** in a shared `meta` entry: its run, provenance, text and load, and the pass that replaced it. At most 4 per check and 1,024 in all, each until the 7-day cutoff. Prune keeps its text, run and log meanwhile. Today the text is lost at the next hourly prune, which also explains gh-67's missing failure text. Its run and log already live 7 days, so no log grows.
- `failures` lists replaced failures, marked. `why` lists them with their runs and logs, and also keeps up to 5 older stored failures visible below its newest 20 results.
- Nothing moves the key format or a stored row's meaning. Every changed line is off the validity path the key-format alarm compares. Three code rows: R1 and R2 can run side by side; R3 follows both.

## Decisions for the human

One recommendation each; the samples follow the recommendations.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | The selection contract of `failures` | (a) Positional test files or directories, `--check <text>` (repeatable), `--limit <n>`. (b) Flags only: `--file`, `--check`, `--limit`. (c) One positional, read as a path or as part of a check name. | (a). gh-67 asks for `failures <test file>`; `status`, `retry` and `why` take their subject as a positional. (c) makes `failures foo` mean two things. |
| Q2 | Where the test-file frame comes from | (a) Read from the stored stack when shown, beside `location`, only when it differs. (b) Stored at write by each adapter as a new error field. (c) Make it the `location`. | (a). It covers rows already stored and all three runners. It changes no code on the validity path. (b) is blocked for node:test and pytest until 011-48, and old rows lack the field. (c) moves fingerprints. |
| Q3 | How a notice orders the two frames | (a) One line: `at <location>, called from <frame>`. (b) The frame first: `at <frame> (thrown at <location>)`. (c) A line of its own. | (a). The line keeps today's start, which the fingerprint's location also names. The notice gains no line. |
| Q4 | What keeps a replaced failure, and how long | (a) A shared ledger: every failing row a pass replaces at its key, 4 per check, 1,024 in all, until the retention cutoff (7 days). Prune keeps its text, run and log meanwhile. (b) The flaky note gains the failing run's provenance: one per check. (c) As (a), kept until the cap only, past the cutoff. | (a). A second flip keeps the first (gh-54's incident had two). No run log lives longer than today. (b) loses the first of two flips, as today. (c) grows logs: 1,024 runs at cezar's p99 of 3.8 MB is 3.9 GB. |
| Q5 | Does `failures` list replaced failures by default? | (a) Yes, marked `REPLACED`, counted apart in the header. (b) Only with `--replaced`. | (a). The agent asks `failures` what failed. A failure that passed on a retry is the evidence gh-54 lost. The mark and the separate count keep it from reading as current. |
| Q6 | `why`'s window of 20 results when they are all passes (gh-67 Q3) | (a) The newest 20, then up to 5 older stored failures of the check, labelled. (b) Unchanged. | (a). `why` already reads every stored result of the check (`why.ts:173`), so this costs no read. |

## 1. `failures` by test file or check, with a limit, in SQL

**Today** (*read in source code*): `src/cli/failures.ts` accepts only `--json`, `--all-worktrees` and `--since`. `readFailures` (`src/core/status/failures.ts`) calls `ResultRepo.listFailures(filter, 20)` and `countFailures(filter)`. The filter is `{ worktreeId, since }`, and the `WHERE` is `r.outcome = 'fail' AND ...` (`src/core/store/repos/results.ts:184`). No index has `outcome`.

**Cost today** (*measured on cezar's store*, load 11.1): the list scans `results_by_time` newest first until it finds 20 failures. That takes 21 ms for every worktree and 72 ms for this worktree, whose failures are older. The count scans the whole table, 660,622 rows, in 88 to 90 ms. A `failures` call therefore costs about 160 ms of SQL, and `--limit 1000` would take 199 ms.

**The index** (*measured on cezar's store*): `results_by_failure (failure_id)` already exists. `failure_id` is set exactly on the failing rows: 1,065 fail rows have one, and 0 of 658,442 pass rows and 0 of 1,115 skip rows do. The invariant holds by construction (*read in source code*): `recordsForFile` gives every fail a summary from `describeFailure`, which always returns one ("failed without an error message" when there is no error), and `putMany` stores a text for any row with a summary or errors. SQLite does not choose this index for `failure_id IS NOT NULL` by itself, because the store has no `ANALYZE` statistics. With `INDEXED BY results_by_failure` named, as `KEYS_SINCE` already names its index (*verified by experiment*, `failures-sql.mjs`, load 10.6):

| Query, cezar's store | Without the index named (the first four are today's queries) | `INDEXED BY results_by_failure` |
| --- | --- | --- |
| list 20, this worktree | 71.8 ms | 1.0 ms |
| count, this worktree (115) | 90.1 ms | 0.7 ms |
| list 20, every worktree | 21.3 ms | 2.6 ms |
| count, every worktree (1,065) | 88.1 ms | 0.8 ms |
| one test file, every worktree | 9.7 ms | 4.5 ms |
| a directory, 443 failures, list 100 | 107.1 ms | 9.5 ms |
| `--check autosave`, 14 failures, the name built in SQL (rejected below) | 15.8 ms | 15.3 ms |
| list 1,000, every worktree | 198.7 ms | 22.8 ms |

The file filter is `r.check_id IN (SELECT id FROM checks WHERE test_path = ? OR test_path LIKE '<dir>/%' ESCAPE '\')`, which scans the covering unique index of `checks` (22,750 rows) once. A check part is matched by the name `formatCheck` prints. Building that name a second time in SQL would make a second formatter, against C5's rule that "check names are printed and parsed by one shared formatter". The design does the match in three steps inside one read transaction (*verified by experiment*, `check-filter.mjs`, load 10.6):

1. Read the distinct failing checks through the index: 828 checks, 3.4 ms.
2. Match their printed names in JS.
3. List the matching failures by id in SQL (`json_each`).

The whole costs 5.2 ms.

**Arguments**, recommendation Q1 (a):

```
squeal failures [<test file or directory>...] [--check <text>]... [--limit <n>]
                [--all-worktrees] [--since <duration>] [--json]
```

- A path is read from the working directory as `status <path>` reads it (`worktreePath`), and becomes root-relative. It selects the failures of checks whose test path is that path or lies below it. With `--all-worktrees`, the same root-relative path applies in every worktree. The path does not need to be a test file here: a file deleted here, or one that exists only in another worktree, still has stored failures. A path outside the worktree exits 2.
- `--check <text>` selects checks whose printed name contains the text. An exact name from a notice therefore selects its check.
- Given several paths, or several `--check`, a failure matches any one of them. Given paths and `--check` together, a failure must match both kinds.
- `--limit <n>` takes any positive integer and defaults to 20. The total is always printed. `--limit 0`, `-1` or `abc` exit 2.
- The header names the selection: `Failures in every worktree for packages/web/e2e (newest 20 of 443, newest first):`.

Recommendation: R1 (section 5) adds a failure repo off the validity path (section 4) with these queries, and moves `readFailures` to it.

## 2. The test-file frame beside `location`

**Where `location` comes from** (*read in source code*):

- Vitest: the first frame of `error.stacks` that `isProjectFile` accepts (`src/runners/vitest/results.ts:24`). A helper inside the project wins.
- node:test: the first project position in the stack text (`firstProjectLocation`, `src/runners/node-test/run/errors.ts:92`). Same rule.
- pytest: `reprcrash` (`src/runners/pytest/run/report.ts:185`), the innermost frame, which "may name a helper or fixture line" (003 D3).

The known state takes `errors[0].location`, else the test's own declared location (`derive.ts:114`). The fingerprint ends `@ <errors[0].location>` (`fingerprint.ts:187`).

**What cezar's store holds** (*verified by experiment*, `frames.mjs`, 513 distinct failures):

| | Test-level checks | File-level checks |
| --- | --- | --- |
| `location` in the check's own test file | 291 | 3 |
| `location` in another file (a helper) | 91 | 92 |
| of those, the stack text holds a frame in the test file | 60 | 0 |
| no `location` | 21 | 15 |
| the stack text's frame for `location`'s file equals `location` | 382 of 382 | 95 of 95 |

By project: e2e 121 of 126 failures name a helper (`agent-browser.ts`, `poll.ts`), server 52 of 203, web 8 of 118. node:test (`test:unit`, `root:test:unit`) has 2 of 26, neither with a test-file frame. The 31 test-level failures with a helper `location` and no test-file frame are timer callbacks, setup files, React render code and waits across `await`. In those, the stack holds no frame of the test at all.

The last row of the table is the important one. Vitest's stored `stack` text is source-mapped exactly as the structured `stacks` from which `location` came, and node:test's is the same text that `location` was read from. A frame read from the stored text is therefore as exact as one the adapter would record. That holds for Vitest and node:test.

**pytest** (*read in source code; inferred*): the stored `stack` is the long report. A long or short traceback names each entry as `<path>:<line>: `, so the test file's entry is the first line whose path is the check's test path. A native traceback names it `File "<path>", line <n>`. `--tb=line` and `--tb=no` leave no frames, so no frame is shown. No pytest failure is in cezar's store, and no live run was made.

**Design**, recommendation Q2 (a) and Q3 (a):

- `testFileFrame(check, errors)`, pure, in a new `src/core/status/test-frame.ts`: it parses the first error's `stack` for the first position whose path is the check's test path. The forms are `path:line:column` (V8) and `path:line:` and `File "path", line n` (pytest). It returns `null` when there is none, when the position equals `location`, or when the check has no test path. It never guesses.
- The frame is shown wherever a failure prints `at <location>`: change notices (`delivery/format.ts:136`), the registration's and Stop's known failures (`format.ts:381`), `status`, `failures` and `why`'s `Location:` line. The form is `at <location>, called from <path>:<line>[:<column>]`.
- The frame comes from the stored row behind the failure: the row at the state's key, read as `attribution.ts` already reads rows (`byKey`, cached per key). When there is no such row (replaced, pruned, or a setup check with no row), there is no frame. Evidence that is gone is never implied.
- `--json`: `testFileFrame` beside `location` on `FailureEntry` (which also gains `location`, absent today), on `KnownFailure`, on the delta entry and on `WhyReport`. All additive.

## 3. A failure a passing retry replaced at the same key

**Today** (*verified by experiment*: `research/probes/issue-54/` and `probes/replaced-prune.ts`; *read in source code*):

- `putMany` writes `INSERT OR REPLACE` on `PRIMARY KEY (check_id, key)`. A pass, from a retry, a 001-171 re-run or another worktree's run at that key, overwrites the fail.
- The flaky note (`flaky-checks`, one per check, newest 1,024 checks) keeps only the key, the two outcomes, the two worktrees, the time and the summary. A second flip of the check replaces the first.
- Prune drops the failure's text at its next pass: `dropOrphanFailureTexts` deletes every text no result references. Prune runs 60 s after each daemon starts and then hourly (`lifecycle.ts:188, 335`), from every live daemon. The probe shows text count 1 after the replacement and 0 after the prune an hour later, while the failing run's row and log stay.
- The run and its log go at the first prune past the 7-day cutoff (`prune.ts:89`). The probe shows them gone at +8 days.
- So the stack, the errors and the link from check to run are lost within the hour. The run log survives for 7 days, unreachable. gh-67's recurrence, a failure "absent from `failure_texts` entirely" (its Q4), is this prune (*inferred*: the incident's store was not read).

**How often** (*measured on cezar's store*): `flaky-checks` holds 192 checks flipped in 7 days, 173 of them `fail -> pass`. The note keeps one per check, so that is a lower bound on flips. There were 75 on 2026-10-15 alone. `retries` ended 58 `passed`. A same-key replacement needs the same inputs, so a code fix (which re-keys the file) never makes one: these are flaky or environment failures only.

**Design**, recommendation Q4 (a) and Q5 (a):

- **What is kept.** A new shared `meta` entry `replaced-failures`, beside `flaky-checks`, `failed-run-loads` and `rerun-first-failures`: a JSON array, oldest first. One entry per failing row that a pass replaced at its key, holding:
  - the check and the key;
  - the failing run's id, worktree, revision, commit, dirty flag, record time and duration;
  - its location, fingerprint, summary and failure text id;
  - the load per CPU its run had (copied from `failed-run-loads` when the entry is written, since that keeps only 1,024 runs);
  - the passing run's id, its worktree and its time.

  A fail replaced by a fail is not kept: it is the same failure stored again (C5 calls it no news), and 011-19's `rerun-first-failures` keeps a slow file's first error for its re-run.
- **Where it is written.** In the tier's commit, in the same transaction, beside `recordFailedLoad`, at `src/core/scheduler/tiers.ts:637`. `storeResults` has no other caller. Before `storeResults`, a new repo query reads the failing rows at the key with their failure text ids, which a `ResultRecord` does not carry. After it, an entry is written for each of those checks whose new record is a pass. Writing in `storeResults` itself was rejected (section 4).
- **What a second flip keeps.** Every flip is its own entry, keyed by check, key and failing run: at another key (gh-54's revisions 1 and 2), and again at the same key. Per check the newest 4 are kept; past that the check is flaky, and its flaky note says so. In all, the newest 1,024 are kept, as every shared `meta` list keeps.
- **How long.** Until the failure is older than the retention cutoff, `store.retentionDays`, 7 days by default. Prune drops expired entries in its own short transaction. While an entry is kept, prune keeps the runs and failure texts it names. Both are tested against `json_each` of the entry in the existing `DELETE`s. Its run and log are therefore kept exactly as long as today; only its text now lives that long too.
- **What `failures` shows.** The stored failing rows and the kept entries, merged newest first and cut at `--limit`. The rows are filtered and limited in SQL. The entries, at most 1,024 in one `meta` row, are filtered in the same read transaction in memory by the same selection. The total counts both. A replaced failure prints `REPLACED` where a stored one prints `FAIL`, followed by `replaced by PASS <time> (<worktree>, run <id>)`, and its load per CPU. `--json` gains `replacedBy` and `loadPerCpu`, additively.
- **What `why` shows.** A `Replaced failures (N, newest first)` block lists each kept entry of the check with its run, the run's log or that it was pruned, and the first error's stack from its text, or that the text was pruned. The `Flaky:` line stays. Its `the FAIL it replaced` sub-line is left out when an entry at the same key is listed. Q6 (a): after the newest 20 results, up to 5 older stored failures of the check under `Older failures still stored`.
- **What does not change.** The known state, `Known failures`, delivery (`FAIL -> PASS` with the flaky note), lookups, held fails and the full-suite checkpoint never read the entry. The verdict semantics are today's.

**Store growth bound** (*measured on cezar's store; inferred for the sum*):

| Part | Bound | Typical on cezar's sizes |
| --- | --- | --- |
| The `meta` row | 1,024 entries of about 1 KB each (key 64 chars; fingerprint 111 on average and 1,937 at most; summary 73 on average and 300 at most; check 143 on average) | about 1 MB at the cap, about 0.2 MB for a week like cezar's 173 or more |
| Failure texts kept | at most 1,024 texts, deduplicated with stored ones; per text p50 1.4 KB, p95 13 KB, max 52 KB | cezar's whole table holds 404 texts, 1.0 MB |
| Runs and logs | none beyond today: an unreferenced run already lives until the cutoff | 0 |

The `meta` row is rewritten only on a same-key flip, about 25 to 75 times a day on cezar. Each rewrite parses and writes at most about 1 MB inside the commit's transaction.

A release before 011-64 never reads the entry. Its prune still drops a kept text at its next pass. `why` then says the text was pruned, and a run that is gone reads as a pruned log, as `runLogUnavailable` already does.

## 4. The key format, a stored row's meaning, and the code rows' seams

**011-37's rules** (C3 as amended 2026-10-20; *read in source code*, `test/keys/key-format.test.ts`, `test/keys/validity/verdict.ts`): a key format or adapter version moves only when a row an earlier release stored would be written or accepted differently, and a raise needs a case whose outputs differ (D6). The alarm compares the emitted code of each component's entries (`test/keys/validity/entries/`) with the last release's. Changed code passes with no raise only while every case agrees **and every changed line ran in a case**. A changed line that no case runs fails the comparison: "changed lines no case runs, each needing a case under test/keys/validity/cases/". A deleted line counts on the last release's side.

**What the entries reach** (*verified by experiment*, `reach.mjs`, a static import walk that over-counts what esbuild keeps):

- The global entry reaches `src/core/store/repos/results.ts`, `src/core/store/schema.ts`, `src/core/scheduler/store-results.ts`, `src/core/state/flaky.ts`, `derive.ts`, `fingerprint.ts` and the `state` barrel.
- The Vitest, node:test and pytest entries reach their adapters' error builders: `vitest/results.ts`, `node-test/run/errors.ts` and `pytest/run/report.ts`.
- No entry reaches `src/core/scheduler/tiers.ts`, `src/core/store/store.ts`, `src/core/store/prune.ts`, `src/core/status/`, `src/core/delivery/attribution.ts` or `src/cli/failures.ts`.
- No validity case calls `storeResults` (`test/keys/validity/harness/store.ts` runs `storeDecision` only). A changed line in `store-results.ts` or `flaky.ts` would therefore fail the comparison until a case and harness are added for it.

**Consequences:**

1. **R1's query lives off the path**, in a new `src/core/store/repos/failures.ts`, wired as `store.failures` in `store.ts`. `ResultRepo.listFailures` and `countFailures` stay in `results.ts`, unused, because removing them changes lines on the path that no case runs. They go with the next release that raises the key format anyway (011-37 D6). That is a follow-up line on the board, not a raise.
2. **R2 reads the frame**; no adapter changes. A frame recorded at write would change all three adapters' code. The `adapter:vitest` kind would cover Vitest's changed lines: the errors are wording (`wordingOf`), so the result is listed and no raise is needed. node:test and pytest have no case kinds yet (row 011-48), so their changed lines would fail the comparison.
3. **R3 writes in `tiers.ts`**, not in `storeResults`. The ledger lives in the store layer, in a new `src/core/store/repos/replaced.ts` reached through `store.failures`. `src/core/store` imports nothing from `src/core/state`, and prune needs the ledger. No entry reaches the module, and `results.ts` does not change.
4. **No schema migration.** `SCHEMA_VERSION` has been 1 since the first release (`schema.ts`). A migration to 2 makes every older release refuse the shared store (`newer-schema`, `open.ts:71`), in every worktree that still runs one, and blocks a downgrade. The existing index makes a new one unneeded.
5. **No stored row changes meaning.** A `results` row stays the newest result under its key, written exactly as today. The replaced failures are history beside it, read by `failures` and `why` only. `--json` grows additively, with no `schemaVersion` raise (011-51's precedent).

Recommendation: no key format raise, no adapter version raise, no schema migration. Each row's done-when includes `test/keys/key-format.test.ts` passing with the alarm silent.

## 5. Code rows

Provisional names; the board gives the numbers on acceptance. Each row is a release with a review PASS on its candidate (`docs/process.md`). R1 and R2 own disjoint files and can run side by side; R3 needs both.

**R1. `failures` by test file, directory and check, with a limit (gh-67 part a).**

- Seams: `src/cli/failures.ts` (positional paths, `--check`, `--limit`, usage text); `src/core/status/failures.ts` (`readFailures` resolves the paths as `worktreePath` does and reads through `store.failures`; the header names the selection); new `src/core/store/repos/failures.ts` (`list`, `count`, `failingChecks`, each `INDEXED BY results_by_failure`, the file and directory filter, the check filter by ids); `src/core/store/store.ts` (wiring); types `src/core/types/store.ts` (`FailureRepo`, `FailureSelection`; additive) and `status.ts` (`FailuresResult.selection`; additive); the `squeal failures` line of `HELP` in `src/cli/main.ts`.
- Not the row's: `results.ts`, `schema.ts`, `why*.ts`.
- Done when, as tests:
  1. issue-67's scenario: 32 stored failures, the target file's 2 the oldest. `failures --all-worktrees <test file>` lists both, total 2. Red before: exit 2.
  2. A directory selects its files' failures. A path typed from a subdirectory resolves against the working directory. A path outside the worktree exits 2. A file deleted here still lists its stored failures.
  3. `--check autosave` lists the failures of every check whose printed name holds it, across worktrees. With a path, a failure must match both.
  4. `--limit 50` lists 50 of 60 and prints the total 60. `--limit 0` and `--limit x` exit 2.
  5. `EXPLAIN QUERY PLAN` of each list and count query names `results_by_failure`.
  6. A test pins the premise: every fail `recordsForFile` returns has a summary, so `putMany` stores a text for it.
  7. `key-format.test.ts` passes, the alarm silent.
- The landing note gives cezar-copy timings as section 1's table does.
- Most likely false: test 2's `--all-worktrees` reading, where a path typed in a subdirectory of this worktree selects the same root-relative path in the others. A test seeds two worktrees.

**R2. The test-file frame beside `location` (gh-67 part b).**

- Seams: new `src/core/status/test-frame.ts` (`testFileFrame`, pure); `src/core/delivery/attribution.ts` (each failing entry and known failure gains the frame from the stored row at its key); `src/core/delivery/format.ts` (the `at` line); `src/core/status/format-status.ts` (known failures); `src/core/status/why.ts` and `format-why.ts` (`Location:`); types `TransitionEntry`, `KnownFailure` and `WhyReport` gain `testFileFrame?` (additive).
- Not the row's: `src/core/status/failures.ts` (R1, then R3), every adapter.
- Done when, as tests:
  1. issue-67's Vitest-shaped error (helper frame first, test-file frame second): a change notice, the registration's known failure, `status` and `why` print `at test/harness-parity.testkit.ts:823:40, called from test/harness-autosave.test.ts:84:15`. `location` and the fingerprint are unchanged. Red before.
  2. A node:test stack (`at TestContext.<anonymous> (test/a.test.ts:12:3)`) and pytest long, short and native reports give their test-file frames. `--tb=line` gives none.
  3. No frame when `location` is in the test file, when the stack has none (a timer callback, as cezar's `agent-browser.ts:835:67`), or when no stored row is behind the failure.
  4. `key-format.test.ts` passes, the alarm silent.
  5. The 10,000-character cap still holds on the largest seeded registration.
- Most likely false: test 2's pytest forms, since none was seen on a real store. One test per traceback style, from fixtures written by a real pytest run.

**R3. Replaced failures kept, and `why` keeps older failures visible (gh-54; gh-67 Q3).** After R1 and R2.

- Seams: new `src/core/store/repos/replaced.ts` (the `meta` entry `replaced-failures`: record, read, caps 4 and 1,024, expiry, and the run and text ids prune keeps), exposed through `store.failures` with `failingAt(key)`, the failing rows at a key with their failure text ids; `src/core/scheduler/tiers.ts` (one read before `storeResults` and one call after it, beside `recordFailedLoad`); `src/core/store/prune.ts` (keep the runs and texts that kept entries name; drop expired entries); `src/core/status/failures.ts` (the merge, `REPLACED`, `location`, `testFileFrame` and `loadPerCpu`); `src/core/status/why.ts` and `format-why.ts` (`Replaced failures`, `Older failures still stored`; the flaky sub-line rule); types `ReplacedFailure`, `FailureEntry.replacedBy`, `WhyReport.replacedFailures` and `olderFailures` (additive).
- Not the row's: `store-results.ts`, `flaky.ts`, every other `src/core/state/` file, `results.ts`, `schema.ts`.
- Done when, as tests:
  1. issue-54's probe scenario: a fail at 3.33 load per CPU, then a passing `load` retry at the same key. `failures` lists the failure as `REPLACED`, with run id, time, revision, load per CPU and the passing run. `why` names the failing run, its log and its first error's stack. Red before.
  2. Two flips of one check at keys k1 and k2, and two at k1: all kept, newest first. A 5th entry of one check drops that check's oldest. The 1,025th entry drops the oldest of all.
  3. A prune 1 h later keeps the entry's text, run and log. A prune 8 days later drops the entry, then its run, log and text. A text deleted as an older release would delete it: `why` says it was pruned and prints no stale path.
  4. Two stored fails and 22 newer passes of one check: `why` lists both fails under `Older failures still stored`. Red before.
  5. The known state, `Known failures`, the `FAIL -> PASS` delivery with its flaky note and the checkpoint: the existing tests pass unchanged.
  6. `key-format.test.ts` passes, the alarm silent.
- Most likely false: test 6. If the new module's code ends up in the global bundle, the alarm fires with lines no case runs. The test proves it either way. Second: the commit's write lock. A tier whose files flip at one key rewrites the `meta` row once per file. A test seeds 8 flips in one tier at 1,024 kept entries and bounds the commit's time.

## Spec text (drafts, for the amendments)

**011 C5**, a paragraph after the gh-32 amendment: "Amended 2026-10-NN (the human, gh-67 and gh-54, row 011-64; `tasks/011-64/design.md`): a failure whose location is not in its check's own test file also names the first frame in that file, `at <location>, called from <path>:<line>[:<column>]`, wherever it prints its location: a change notice, the registration's and Stop's known failures, `status`, `failures` and `why`. The frame is read, when shown, from the first error's stored stack, the source-mapped text the runner reported. It is never stored, so `location`, the fingerprint and every key stay as they are. It is absent when the stack holds no frame in the test file, when the frame is `location`, and when no stored row stands behind the failure; it is never guessed. A failing row that a pass replaces at the same key (C7), by a retry, a re-run or another worktree's run, is kept as a **replaced failure** in the shared `meta` entry `replaced-failures`. It holds the check, the key, the failing run's provenance (run, worktree, revision, commit, dirty flag, record time, duration), its location, fingerprint, summary and failure text, the load per CPU its run had, and the run, worktree and time of the pass. At most 4 are kept per check and 1,024 in all, newest kept, each until its failure is older than the retention cutoff (C7). It is history: no known state, transition, delivery, lookup or held fail reads it, and the flaky note stays as it is."

**011 C6**, replacing the 2026-10-15 amendment's sentences on `squeal failures` and the last sentence on `why`'s results: "Amended 2026-10-NN (the human, gh-67 and gh-54, row 011-64): `squeal failures [<test file or directory>...] [--check <text>]... [--limit <n>] [--all-worktrees] [--since <duration>] [--json]` lists the stored failing results and the replaced failures (C5), newest first. Each replaced one is marked with the pass that replaced it. It lists at most `--limit`, 20 by default, with the total and how many are replaced. A path is read from the working directory as `status <path>` reads it. It selects the failures of checks whose test path is that path or lies below it, in every worktree with `--all-worktrees`, whether or not a test file has that path here. `--check` selects the checks whose printed name holds the text. Given both, a failure must match both. The selection and the limit are applied in the store's query, in one read transaction; the command starts no daemon and creates no store. Each failure names its location and its test-file frame (C5). `--json` adds `location`, `testFileFrame`, `loadPerCpu`, `replacedBy` and `selection`. The command lists failures still stored or kept as replaced, not every failure ever seen. `why <check>` lists its newest 20 results. Below them it lists up to 5 older stored failures of the check, then the check's replaced failures with their runs and logs."

**011 C7**, appended to "Pruning": "Amended 2026-10-NN (row 011-64): while a replaced failure (C5) is kept, prune keeps its failure text, its run and its run log. Once the failure is older than the cutoff, prune drops the entry and then them. A release before 011-64 still drops such a text at its next pass and the run at the cutoff, and `why` says what was pruned."

## Rejected options

- **A new index, such as a partial one on `outcome = 'fail'`**: it needs a schema migration, which makes every older release refuse the shared store and blocks a downgrade. The existing `results_by_failure` gives the same plans.
- **Filtering in JS after reading every failure**: it reads every failing row and its text (1,065 rows and 1.0 MB of text on cezar) on every call, and grows with the store. The brief asks for SQL.
- **The check name built in SQL**: a second formatter of check names, which C5 forbids. The JS match over the failing checks costs 3 to 4 ms.
- **The test-file frame as `location`**: it moves the fingerprint of every helper-thrown failure. Under 011-41's review rule that asks for a `VITEST_ADAPTER_VERSION` raise, which re-keys every Vitest file, and every standing helper-thrown failure would read as changed once.
- **The frame stored at write, in the error or in a `known_states` column**: the error field changes three adapters on the path (node:test and pytest wait for 011-48), and rows already stored lack it. The column needs a migration.
- **A table of replaced results**: a migration, as above.
- **Both rows kept in `results`, or the replaced row kept under a derived key**: either changes what a stored row means. "One row per check and key" (C7) is read by every lookup, prune and count, and an older release would read the derived row as a result.
- **The flaky note extended with the failing run (Q4 (b))**: one note per check, so a second flip loses the first, as in gh-54's incident.
- **Kept until the cap only, past the cutoff (Q4 (c))**: run logs outlive the 7-day rule. At cezar's p99 of 3.8 MB per run, 1,024 runs are 3.9 GB.
- **Recording in `storeResults` or `recordFlips`**: both are on the global validity path, and no validity case runs them. Every changed line would need a new case and harness, for code that decides nothing about validity.
- **`--replaced` to list replaced failures (Q5 (b))**: an agent that does not know the failure was replaced does not know to ask.

## Samples

Before: issue-67's probe, today's source (`research/issue-67.md`):

```
$ squeal failures --all-worktrees test/harness-autosave.test.ts
squeal failures: unexpected argument "test/harness-autosave.test.ts"
```

After R1 and R3, the same store (by hand, from the probe's seed):

```
$ squeal failures --all-worktrees test/harness-autosave.test.ts
Failures in every worktree for test/harness-autosave.test.ts (2 failures, newest first):
  FAIL  2026-10-21T09:12:40.118Z  test/harness-autosave.test.ts > saves after idle
        /work/wt-2, revision 4, commit abc123, dirty, 12 ms, run run-7, load 0.41 per CPU
        AssertionError: expected 'idle' to be 'saved' @ test/harness-parity.testkit.ts:823:40
        called from test/harness-autosave.test.ts:84:15
  FAIL  2026-10-21T09:02:11.507Z  test/harness-autosave.test.ts > saves after idle
        ...

squeal why "<check>" prints a failure's full output.
```

A change notice, after R2 (by hand, from cezar's `tab-coordination.e2e.ts` failure in `probes/output.txt`; the message is illustrative):

```
FAIL  [e2e] packages/web/e2e/tab-coordination.e2e.ts > keeps one leader
  first observed: FAIL; ...
  Error: poll timed out after 5000ms
  at packages/web/e2e/poll.ts:68:38, called from packages/web/e2e/tab-coordination.e2e.ts:72:7
```

`why` after issue-54's retry. Before, from `research/issue-54.md`: a `Flaky:` line and its summary only. After R3 (by hand, from issue-54's output; the stack line is illustrative):

```
Known state: PASS, current, observed at revision 0, commit 95603d9
  Flaky: FAIL -> PASS under the same inputs (key 13b164a38a5d, 2026-10-20T16:44:01.192Z)
History (2 transitions, oldest first):
  revision 0  2026-10-20T16:44:00.694Z  first seen FAIL
  revision 0  2026-10-20T16:44:01.193Z  FAIL -> PASS
Results (1, newest first):
  PASS  2026-10-20T16:44:01.191Z  … run 5f05a61a-…, 2 ms, key 13b164a38a5d
Replaced failures (1, newest first):
  FAIL  2026-10-20T16:44:00.689Z  this worktree, revision 0, commit 95603d9, clean, 6 ms, run 4086a9d4-…, load 3.33 per CPU
        replaced by PASS 2026-10-20T16:44:01.191Z (this worktree, run 5f05a61a-…), key 13b164a38a5d
        AssertionError: expected true to be false // Object.is equality
            at test/flaky.test.ts:5:18
        Run log: …/runs/4086a9d4-…/vitest.log
Run log: …/runs/5f05a61a-…/vitest.log
```

## What is not known

- pytest's frame forms are inferred from the long report Squeal stores (`report.ts`); none was seen on a real store, and no pytest ran. R2's test 2 uses fixtures from a real run.
- The number of same-key flips per check: `flaky-checks` keeps one per check, so cezar's 173 is a lower bound on checks, not on flips.
- That the alarm stays silent was inferred from a static import walk; no bundle was built. Each row's done-when runs `key-format.test.ts`.
- The indexed plans assume failing rows are about all rows with a failure text. On cezar no pass or skip row has one. A runner that reports errors on passing tests would widen the index range. It would not make the list wrong, since `outcome = 'fail'` stays in the `WHERE`.
- The incident stores of gh-54 and gh-67 (cezarion PRs #1330 and #1323) were not read. The prune explanation of gh-67's missing text was verified on a scratch store only.
- Live timings: the host's load was 10.6 to 39.6, so no live `squeal` run was made. The SQL ran on a copy. The CLI's own open and format costs come on top of the SQL figures.
