# 015 The code squeals: complexity, coverage and CRAP per function

## Problem

Squeal tells an agent when a test changes state. It tells the agent nothing about the code itself. An agent can make a function much more complex, or add a branchy function that no test runs, and every test still passes. Squeal then says "no known failures", and the risk is invisible until a reviewer reads the diff.

The vision expects this: "Tests are the first check type, not the last." The same transition model fits other signals that flip between states and are tied to a revision. The human (2026-10-23) asked whether Squeal could calculate cyclomatic complexity (CC), coverage and the CRAP score, share them between worktrees, keep them opt-in, feed the agent on the fly and give details on demand: "the code can squeal as well, not just tests".

The research (`research/coverage-collection.md`, `complexity-and-crap.md`, `agent-feedback.md`) found it feasible:

- CC costs 2 to 4 ms per file, needs no test run, and depends only on the file's bytes.
- Coverage from Squeal's own runs costs about +8% CPU per run (wall time within noise).
- CRAP needs one more rule: it stays pending until every test that covers the function has a current result.

## Goals

Wave 1, complexity (the human, 2026-10-23: complexity first):

1. Off by default. With `complexity.enabled` unset or `false`, Squeal counts nothing, creates no code store and writes nothing new to the store, and every delivery, status and exit code is byte-identical to the release before (D1).
2. When it is on, every function in the included files has a known complexity state, `pass` or `fail`, with the revision and blob it was counted at. Squeal's count equals ESLint's `complexity` rule (classic variant) on every `src/` file of this repository, and radon's on the research's Python corpus (D3).
3. A function that goes over the threshold, or a new function that starts over it, is delivered the way a test failure is delivered. A function that goes back to the threshold or under it is delivered as a recovery. A change of the count while the function stays over is quiet (D5, D6).
4. A registration shows the number of functions over the threshold and the command that lists them, never the list (the human, 2026-10-23, "don't flood the agent") (D6).
5. The first edit in a session to a function that is already over, and that leaves it over, delivers one line about it, once per session (D6, its own row).
6. A move or a rename that keeps the function's body keeps its state and delivers nothing (D2).
7. Complexity never denies a tool call, never counts in `Known failures`, and never blocks Stop, unless `complexity.blocking` is `true` (D7).
8. Cost: the counter runs only on files a revision changed. A changed file costs at most 5 ms at the median and 20 ms at p95 on this repository's files. The first count of this repository's included files takes at most 5 s of CPU. A second worktree at the same files counts nothing again, because counts are shared by blob through the code store (D4).

Wave 2, coverage and CRAP (after wave 1's dogfood):

9. With `coverage.enabled`, Vitest runs that Squeal makes anyway collect coverage per test file through a provider of Squeal's own. There is no extra run, the project needs no package, and Squeal writes no report. On the research's 30-file sample the CPU is at most 10% above coverage off, and the wall time is within noise, both recorded with the load (D8).
10. A test file that can read V8 coverage itself gets no coverage, and status names it (the human, 2026-10-23, "skip and name") (D8).
11. Each function has a CRAP state and a "no test runs it" state. Each is `pending` until every test file that loads the function's source has a current result with a coverage record, and `unknown` when one of those files can have no record (D9).

## Non-goals

- Line-level test selection. The research measured 71% fewer runs on a 30-file sample. It is measured on the full suite after 015's coverage records are in the store, and 011's non-goal "Per-test closures from runtime coverage" stands until then (the human, 2026-10-23).
- The istanbul provider: +28% wall time, and tests can see it (`coverage-collection.md` Q4, Q5).
- Coverage reports (HTML, lcov, clover), project totals in a push, and patch coverage percentages. A project that wants them keeps its own `vitest --coverage`.
- Cognitive complexity. CRAP is built on CC, and SonarSource's own paper says CC measures testability (`complexity-and-crap.md` 1).
- Coverage under node:test and pytest. The research found both feasible (`coverage-collection.md` Q3); they are later rows. Complexity counting covers Python from wave 1, since it needs no runner.
- Coverage of code that tests reach only through a child process. Such a function reads "no test runs it". Collecting it would be visible to tests (`coverage-collection.md` Q5, Q6).
- Languages other than TypeScript, JavaScript and Python.

## Design

### D1. Policy

New keys in `squeal.config.json` (011 C10):

| Key | Default | Meaning |
|---|---|---|
| `complexity.enabled` | `false` | Count CC per function and keep its state. |
| `complexity.threshold` | `20` | A function fails when its CC is above this. 20 is ESLint's default `max`. At 20, crossings happened in 5% of this repository's last 300 commits, and at 10 in 16% (`complexity-and-crap.md` 8). |
| `complexity.include` | every file Squeal sees with a supported extension | Globs. Supported: `.ts .tsx .mts .cts .js .jsx .mjs .cjs .py`. |
| `complexity.exclude` | `["**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"]` | Globs. A project's list replaces the default. |
| `complexity.maxFileBytes` | `524288` (512 KiB) | A larger file is not counted; D6 tells the session once when it edits one. |
| `complexity.blocking` | `false` | D7. |
| `coverage.enabled` | `false` | Wave 2, D8. Needs `complexity.enabled`. |
| `crap.threshold` | `30` | Wave 2, D9. Savoia's threshold and php-code-coverage's default. |

Both thresholds and the size limit are the project's to set; the defaults are the starting numbers (the human, 2026-10-23). These are never counted: test files (any file a runner lists), files under `node_modules`, files git ignores, and files over `complexity.maxFileBytes`. The watcher already gives Squeal the set of files it sees (011 C2).

A policy change that alters the counted set or the states (threshold, include, exclude, a new counter version) re-counts the files that need it. It delivers one summary line, never one transition per function (D6).

### D2. A function's identity

A code check is identified by `(relative path, qualified name, occurrence)`:

- **Qualified name**: the chain of enclosing classes and functions plus the function's own name: `Ledger.settle`, `createDelivery.deliver`.
- **Anonymous functions** (38% of the functions here) are named by the call they are passed to, inside their parent: `createDelivery.deliver.<transaction>`. If the function is not an argument, the name of the variable or property that receives it is used.
- **Occurrence**: the 0-based index among functions in the file with the same qualified name, in source order. 1.1% of the functions here share a name.
- **Body hash**: the hash of the function's text with whitespace normalised. It is not part of the identity. It follows a move or a rename.

**Moves and renames.** When a revision removes a function and adds one with the same body hash, the new check takes over the old one's state and every delivery view's entry for it. The two may be in the same file or in different files. Nothing is delivered. The research found 33 of 113 "new" functions were such moves (`agent-feedback.md` 4).

A function that is moved and edited in one revision reads as a removed check plus a new one. That is an accepted limit. An edit to the call text renames an anonymous function the same way.

A removed check whose last delivered state was `fail` is delivered once as resolved: "no longer in the code". This follows 011 C5's rule for a retired failing test.

Code checks are their own kind beside `CheckId` (`src/core/types/check.ts`), never a member of it. They have no run, re-run, retry, held failure, inherited confirmation or checkpoint, and they share none of the scheduler's paths (011 C4). Wave 0 settles the types.

### D3. Counting

The counter is `web-tree-sitter`, which every plugin already ships for pytest (007 D4), plus the `tree-sitter-tsx` grammar (+1.45 MB per plugin). That one grammar parses `.ts`, `.tsx` and `.js` to the same counts as the TypeScript grammar on all 605 `src/` files (`complexity-and-crap.md` 2). Python reuses the shipped `tree-sitter-python` grammar.

Each function starts at 1 and adds 1 per decision point, by ESLint's classic `complexity` rule for TS and JS:

- `if`, loops, `for…of` and `for…in`;
- each `case` with a test;
- `catch`;
- the ternary operator;
- the logical operators `&&`, `||` and `??`;
- `?.` member access and calls;
- default parameters and destructuring defaults;
- logical assignment.

Python follows radon's rules (`complexity-and-crap.md` 1). A nested function is its own function, and its decisions are not its parent's.

The grammar's `.wasm` is copied into each plugin's `dist/` like the Python grammar (`src/harness/build.ts`). `COUNTER_VERSION`, a small integer, moves when a counting rule or a grammar changes, so that stored counts are never reused across a change of meaning.

`tree-sitter-tsx` 0.23.2 reads `import("x")` in a type argument, as in `f<typeof import("x")>()`, as a comparison. The TSX parse input replaces each such `import("…")` with underscores of the same length, so every offset holds. Names and body hashes read the file's own text, never the parse input (amended 2026-10-24, 015-29, `COUNTER_VERSION` 3).

`?.`, `??` and defaults make up 31% of the functions at CC 10 or more here. They are counted, because that is the number ESLint and the peer tools show. Open question 1 records the choice.

A file that does not parse completely has an `unknown` state for each function in its error ranges. It is named in `squeal code`, and it delivers nothing.

### D4. Storage and the daemon's pass

**The code store.** Code data lives in its own SQLite file beside the store, `<common-dir>/squeal/code.sqlite`, with its own `user_version`. It is created only when the policy is on, so with the policy off nothing on disk changes (goal 1). The main store's schema stays as it is: it has never been raised, and a raise would make every older daemon of the repository exit and every older hook report "status unavailable" (011 C7). The code store follows C7's rules otherwise: WAL, busy retries, reads without writes for `status` and `squeal code`, and retention.

**Indexes after version 1** (amended 2026-10-25, row 015-44). An index that only adds a read path arrives at open, not as a migration. An opener that may create the file looks for it in `sqlite_master`; when it is absent, it takes the write lock, looks again, and makes it. `user_version` stays, so a daemon that predates the index keeps the store, and SQLite keeps the index current on its writes. A store that has the index opens with no write lock. A reader never makes it and reads the same answers without it, more slowly. No column is added to an existing table under an unchanged `user_version` (011 C7, as amended by spec 016). The first index is `coverage_stored (result_key, provider_version, recorded_at)`, which gives a record's stored time without its blob.

**Counts.** Counts are stored by `(blob id, language, COUNTER_VERSION)`, the blob id being 011 C3's file hash. Each entry holds the file's functions: identity, range, body hash, CC and the count of decision points by kind. The entry depends on the bytes alone, so every worktree shares it through the code store and nothing is counted twice. Retention follows C7: an entry that no worktree's current file uses, and that no kept state was judged on, is pruned with old results (amended 2026-10-24, 015-17).

**States.** The per-worktree known state of each code check is: state, value, threshold, the revision and blob it was counted at, and the revision it last changed state. Changes of state are recorded as transitions, as 011 C5 records them for tests.

**The pass.** On each revision the daemon counts the included files the revision changed (011 C2), after looking each blob up in the store. It runs in the daemon process, outside the scheduler's lanes, and takes no test permit (011 C10). A count the counter fails on is tried again 5 s and then 60 s later, three times in all, then not until the file's blob changes or a daemon starts; meanwhile the file keeps its last judged states. A grammar load that failed is made again at the next count (amended 2026-10-24, 015-18).

A failed edit's count keeps the threshold it was made under. When a retry succeeds after a threshold change, a function's transition is recorded only when its outcome is the same at the current threshold, at the threshold of its stored state and at the edit's. A crossing that only the threshold change made is not told; the policy change's summary line already told it (amended 2026-10-24, 015-31, from review 0.1.293-r2 N1).

A revision with more than 200 changed files, for example a pull or a checkout, is counted in slices. Between slices the daemon serves requests and starts test tiers. Hooks read only the store; tree-sitter's 30 to 50 ms start happens once per daemon.

**The first count.** It runs at the first start with the policy on, and over the files that lack a count after a policy change. It is counted the same way, and status reports `counting: N of M files` until it is done.

### D5. States and transitions

A complexity check is `pass` when its CC is at or under `complexity.threshold`, and `fail` when it is above. A file Squeal has not counted yet has `pending`, and a parse error gives `unknown` (D3).

Complexity never waits for a test (the human, 2026-10-23). It depends on the file's text alone, so whether the tests pass or fail, or have not run, does not change it. A revision's counts are ready within milliseconds and are delivered at the next delivery point, usually the hook of the edit that made them. `pending` means only that Squeal has not counted the file yet. The wait for test results applies to CRAP and "no test runs it" (D9), which depend on coverage.

011 C5's transitions apply:

| Change | Transition | Delivered |
|---|---|---|
| A new function, over the threshold | first-seen fail | yes |
| `pass` to `fail` | `PASS -> FAIL` | yes |
| `fail` to `pass` | `FAIL -> PASS` | yes |
| `fail` to `fail`, the count changed | none | no; the first edit in a session, once (D6) |
| A function removed while `fail` | resolved, "no longer in the code" | yes, once |
| A move or rename with the same body | none | no (D2) |
| A threshold or include change | none per function | one summary line (D6) |

The fingerprint of a code failure is its rule and threshold, never its value. So 70 becoming 69 is no news (`agent-feedback.md` 4).

### D6. What the agent sees

**Registration.** One line, only when the feature is on: `Complexity: 62 functions over 20; squeal code lists them.` While the first count runs: `Complexity: counting, 340 of 600 files.`, and before it starts in a new worktree: `Complexity: counting has not started.`, never `0 functions over` while the worktree's first count has not ended. A session that registered before that count ends gets one `Complexity counted:` line when it ends (amended 2026-10-24, 015-35). No function is listed. The consumer's view is seeded with every failing state, as 011 C5 seeds test states; a function with no view row reads as passing, and a function that passes leaves the view. Each failing function is marked as told by count only. A change at or before the revision the session counts from is taken into the view by count and never told: that revision is the registration's, or the next one when it is the daemon's start scan and the registration was not scanned, so a change made while no daemon ran is not the session's. The same holds where a parked session resumes: the daemon's start scan after the resume is not the session's, and its own changes from before the pause stay its own (amended 2026-10-24, review 0.1.290 B1, repair R1). SessionEnd drops the session's view rows, and a session sweep drops those of departed consumers (amended 2026-10-24, 015-20).

**A change.** A code transition is delivered with the test transitions of the same delivery, in the same FAIL and PASS block format:

```text
FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23, over 20 (ESLint rule)
PASS complexity: selectTier (src/core/scheduler/tiers.ts:120) is 18, at or under 20
```

A delivery holds at most 5 code transitions in full. The rest become one line: `and 14 more complexity changes; squeal code --changed lists them.` A test failure is always listed before a code transition.

**The first edit to a standing failure** (goal 5; its own row so it can be dropped if it proves complex). The counter knows which functions' own text a revision changed: their body hash moved and their identity stayed. A consumer is told about such a function once, in full, when all of these hold:

- the function is `fail` before and after the revision;
- the consumer's view holds it as told by count only.

The view entry is then marked told in full. Later edits to the function in that session are quiet until its state changes. A revision that moves `HEAD` (a pull, merge, rebase or checkout) marks no edit for a file whose bytes are its blob at the new `HEAD`; a `FAIL` from it is still delivered, and a `PASS` as the next sentences say (amended 2026-10-24, 015-19, 015-38). While a merge, cherry-pick, revert or rebase is under way (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `REBASE_HEAD` exists, or `rebase-merge/` or `rebase-apply/`), a file whose bytes are its blob at a commit the operation brings marks no edit: each `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REBASE_HEAD`, the parent of `REVERT_HEAD`, and, during a rebase, `HEAD` (amended 2026-10-24, 015-34). **A recovery git brought.** A `PASS` or `RESOLVED` of complexity, `crap` or `uncovered`, for a function the consumer's view holds by count only, is taken into the view by count and not told when git brought the last change to the function's file up to the transition's revision: a file whose bytes are its blob at the new `HEAD` or at a commit an operation under way brings, or a file gone at such a commit. A `FAIL` from git is told, and so is a `PASS` or `RESOLVED` for a function told in full (`FAIL` or `STILL FAIL`) or brought by the session's own edit to the file. `crap` and `uncovered` are judged when coverage arrives, so a test the session writes later that makes such a function pass is not told either: the session never heard that it failed (amended 2026-10-24, 015-38, the human's option (a)). After a `FAIL` told in the session, the next edit that changes the function and leaves it over is told once as `STILL FAIL ... is 22 after the edit, over 20`; later edits that stay over are quiet until its state changes. Every `STILL FAIL` line ends with `Squeal stays quiet about it until it is at or under 20, and squeal code <path> shows its count.` (amended 2026-10-24, 015-21, the human's choice). The rule holds for `crap` and `uncovered` (amended 2026-10-24, 015-40). They are judged when coverage arrives, so the coverage step marks the edit: a function the complexity pass marked edited after the measure's last judgement is marked edited for the measure, at the complexity edit's revision. A body git brought is no edit here either, and a recount's judgement marks none. Such a line ends with `squeal code <path> shows its CRAP.` or `shows its coverage.`, and a delivery's title counts these functions once each: `1 function still failing a code check`. With complexity only, the title stays `1 function still over the complexity threshold`.

**The other side.** A delivery with news of one kind ends with at most one line about the other kind, only while that kind has something standing for the session (amended 2026-10-24, 015-27, the human's choice):

- Test news (any test entry) ends with `Complexity: 2 functions over 20 that this session was told about; squeal code --told lists them.` while a function told to the session in full (`FAIL` or `STILL FAIL`) is still over. A function the view holds by count only is not counted. The `crap` and `uncovered` states told in full that still fail are counted too, each measure apart, and a measure with none is left out: `Complexity: 2 functions over 20, 1 over CRAP 30 and 1 no in-process test reaches, that this session was told about; squeal code --told lists them.` (amended 2026-10-24, 015-40).
- Complexity news with no test entry ends with `Tests: 3 known failures; squeal status lists them.` while status's `Known failures` is above 0. A failure that waits for its rerun after an edit is not counted.
- Neither line comes at registration, which gives both, or with the policy off. Stop's full text has no test line, as it already ends with `Known failures: N`. The idle waiter reads the told count only when it has test news.

**A file too big to count.** The first time in a session that an edit changes an included file over `complexity.maxFileBytes`, the session gets one line: `src/big.ts is 600 KiB, over the 512 KiB limit; its functions are not counted.` Later edits to it in that session are quiet. A first count, a recount or a resumed session tells no such line for a file the session did not edit, and a resumed session keeps what it was told (amended 2026-10-24, 015-36). Whether an edit is the session's is decided by the edit's own revision, which a later recount keeps (amended 2026-10-24, 015-39). `squeal code` lists every such file.

**A summary.** A policy change, or a counter version that changes states, delivers `Complexity threshold is now 15: 117 functions over; squeal code lists them.` and re-seeds the views by count. A `crap.threshold` change delivers `CRAP threshold is now 25: 40 functions over; squeal code lists them.` and re-seeds the views by count, once the coverage step has judged every ready file at the new threshold; a file that waits for its records keeps its last judged states. Coverage starting, or switched off and on, tells none (amended 2026-10-24, 015-40).

**Status.** `squeal status` shows one line under the test lines: `Complexity: 62 functions over 20, 2 since this session started; squeal code lists them.` `--json` adds `code: { v: 1, threshold, over, sinceRegistration, pending, unknown, files, uncountable? }`. A file whose attempts are spent is in neither `done` nor `total` of `counting: N of M`, so counting ends when only such files remain; `uncountable` counts these files and the line adds `; N files could not be counted`. `squeal code` lists such a file under `Not judged:` as `unknown: could not count (<error>)` and does not wait for it (amended 2026-10-24, 015-18).

**Details on demand.** These come from a new command, `squeal code`:

```text
squeal code [<path>...] [--changed | --told] [--json]
```

- With no path, it lists every function over the threshold, newest first by the revision at which it went over. Each line gives the location, the CC, its decision points by kind and the revision.
- With paths, it lists every function in those files with its CC, over the threshold or not.
- Files not counted (too big, parse errors) are listed after the functions, with the reason.
- `--changed` keeps the functions whose state changed since the consumer registered.
- `--told` lists the functions over the threshold that the session was told about in full: the same read as the test-news line above, so the two agree. Its coverage part lists the `crap` and `uncovered` states told in full that still fail; it has none when no such state is (amended 2026-10-24, 015-40). In a shell with no session registered here (Pi, a terminal) it lists those told to any registered session, and says so. `--told` with `--changed` exits 2 (015-27).
- `--json` gives a versioned shape. The command reads the store and needs no daemon, like `status` (011 C6).

### D7. Blocking

A code failure never denies a tool call: `interrupt.onRegression` (002) applies to tests only. It never counts in `Known failures: N`, and it does not block Stop.

With `complexity.blocking: true`, Stop's completion check (011 C8) also counts each code check that went to `fail` since the consumer registered: complexity, and `crap` and `uncovered` while the coverage step judges here. A function that was already failing at registration never blocks. With complexity only, the reason reads as before. With a coverage measure among them it names each function once, with what it went to `fail` on: `Squeal policy complexity.blocking is on and 2 functions went to fail since this session started: sel (src/a.ts:4) over complexity 20, hot (src/a.ts:1) over CRAP 30 and no in-process test reaches it. squeal code --changed lists them.` The status line's `since this session started` stays complexity only (amended 2026-10-24, 015-40).

### D8. Coverage from Squeal's runs (wave 2)

With `coverage.enabled`, the Vitest adapter (013) passes `coverage: { enabled: true, provider: "custom", customProviderModule: <Squeal's own>, reporter: [], reportsDirectory: <the daemon's temp directory> }` to `createVitest`. In all other cases it passes `coverage: { enabled: false }`, so a project's own coverage setting never acts in Squeal's runs (row 013-07, which lands first).

**The provider.** Its worker side starts and takes V8 precise coverage through `node:inspector`, as `@vitest/coverage-v8` does. Its main side keeps each batch's payload and writes no report. Vitest gives one payload per test file while files are isolated (`coverage-collection.md` Q1). The provider ships in each plugin's `dist/coverage/`. A daemon that cannot find it runs without coverage and notes it once at start.

**Keys** (amended 2026-10-24, 015-11). A coverage-on instance's key holds `{ provider: "squeal", version: COVERAGE_PROVIDER_VERSION }` in place of the coverage block, never a path. Turning coverage on re-keys every Vitest check once, and so does each raise of that version: those results gain a record. With coverage off the keys are byte-identical to before.

**Mapping.** Each payload is mapped through the transform's source map to source lines and functions, outside the scheduler's path (0.37 s of main-thread CPU per test file). Each payload is read, parsed and mapped in a worker thread beside the daemon; the main thread gives it the sources the payload names and stores the record. Without a worker (from the TypeScript sources, or after one failed, told once), the main thread maps it, and each job waits its own main-thread time before the next (amended 2026-10-25, 015-42, from 011-197: a whole payload's `JSON.parse` on the main thread took up to 8 s per turn).

**The record.** It holds, per source the test file loaded: the source's blob id, a bitset of covered lines and a hit bit per function range. It is stored in the code store (D4) at the test file's result key plus the provider version, so it is adopted with the result (011-23) and pruned with it (C7). The research estimated 9 KiB per test file; Squeal's own test files measure 26.7 KiB, because a record holds every source the file ran (amended 2026-10-24, 015-11).

A record is stored only for a test file that completed whole, all its tests selected, in a run that did not hang, crash or get rejected, and only while the result at the file's current key names that run. A file that completed before a cancellation keeps its record, as it keeps its result; a file the cancellation stopped leaves none (corrected 2026-10-24, review 0.1.295 B3). Otherwise the next run makes it. The daemon prunes the code store after each prune of the main store: counts by D4's rule, records whose result key the main store no longer holds (amended 2026-10-24, 015-11; the counts had no prune caller before).

**Fidelity** (the human, 2026-10-23, skip and name). A test file whose closure imports `node:inspector` or `inspector` is run with coverage off. The adapter lists those files before each run, and a worker that runs one starts no coverage session, so no own tier is needed. Squeal reads that import from the import closure it already keeps. The adapter notes each such file (amended 2026-10-24, 015-11). Status lists those files, and a source that only they load reads coverage `unknown` (wave 2b, D9). One test of this kind failed under V8 coverage in the research (`coverage-collection.md` Q5). 011 C10's Fidelity rule makes that a defect, never an accepted cost.

**`isolate: false` projects** run with coverage off, with one note. In a shared batch, import-time code is credited to the first file that loads it (Q1).

### D9. CRAP and "no test runs it" (wave 2)

**Joining coverage to functions.** A function's coverage is the union of the coverage records of the current results of every test file whose closure holds the function's source at its current blob (C3's reverse index). It is joined to the counter's functions by position, never by name: the body start for TS and JS, and Squeal's own ranges against line data for Python (`complexity-and-crap.md` 4). As built (amended 2026-10-24, 015-12): a V8 function joins the counted function that ends where it ends (same line, within 2 columns) and starts on its line or the one before, since the source map moves an arrow's start to its name; the loaders are the test files whose closure in this worktree's own key index holds the source; a test file whose closure is not known yet keeps the source pending, and status says how many wait (amended 2026-10-24, repair R6, review 0.1.297 B3). A function with no V8 function of its own ran only when its own lines inside its body ran and the function that holds it ran; otherwise its states are `unknown`. Two V8 functions at one span with different hits stay two entries in the record, and the join reads that span as `unknown` (repair R6, review 0.1.297 B4; `COVERAGE_PROVIDER_VERSION` 2, which re-keys coverage-on checks once).

**Two more states per function, beside complexity:**

- **`crap`**: `CC² × (1 − cov)³ + CC`, where cov is the share of the function's own lines that ran, lines inside a nested function left out (amended 2026-10-24, 015-12: V8 gives lines, not statements). A cov of 95% or more gives CC, as in PHPUnit. The state is `fail` above `crap.threshold`.
- **`uncovered`**: `fail` when no current test runs the function in the test's own process. Its lines say "no in-process test that Squeal runs reaches it", which is what it measures: a function that only a child process runs reads `fail`, as the non-goal says (amended 2026-10-24, from 015-30: 50 of 7,582 `src/` functions here).

**Pending and unknown.** Each state is `pending` until every test file that loads the source has a current result with a coverage record. It is `unknown` while any of those files can have none: its current result has no record once the writer is idle and 36 s have passed (D8's skips, a focused run, a runner that takes no coverage), its record cannot confirm the source's bytes, or it has no key. A Squeal-excluded suite such as `test/e2e/**` makes no state `unknown`: Squeal reads none of its closures, so no source is known to be loaded by one, and a rule from static reach is ruled out (015-30); status names the files `vitest.exclude`, `excludeProjects` and `squeal.config.json` leave unread (amended 2026-10-24, 015-12). It is `unknown` too while one of those files skipped tests, so its record cannot show what they run: on a host without uv the pytest runner's tests skip, and 115 functions here would read `fail` (amended 2026-10-24, from 015-30).

Without this rule, the first test file to finish after an edit would make CRAP read too high, and the agent would get a false failure (`agent-feedback.md`, feasibility). Under `baseline.onStart: lookup-only` a state can stay pending until `squeal run --all`. Status says which.

**First judgement.** A function present when coverage starts, or brought by a complexity recount, is seeded `pending`, so its first judgement records no transition; a function an edit added is a first-seen fail. A pending or unknown source keeps its last judged states. A coverage step works for at most `STEP_BUDGET_MS`, its reads of loaders and records included, and does at least one unit of work. Its loader map is read one test file at a time within that budget, its result lookups and closure walk included, and is used only once it is whole (amended 2026-10-25, 015-45). The map, conditions and signatures hold until results, records, a revision or a wake change them, and its decoded records until its chain ends. A record's stored time is its identity: each record stored at a key gets a later one, and a judgement's signature holds each loader's, so a record stored again at a judged key judges its sources again (amended 2026-10-25, 015-44). A recount's seed is still one turn, 429 to 489 ms on 011-197's stores (row 015-47). A step that took `d` ms on the main thread starts its successor no sooner than `d` ms later (amended 2026-10-25, 015-42). A `crap.threshold` change tells no crossing that only the threshold made (amended 2026-10-24, 015-12). A judgement holds the counter version and `crap.threshold`, so a change of either judges again; a recount's judgement stays quiet until each affected function is judged, records that arrive later included (repair R6, review 0.1.297 B1, B2).

**Delivery.** D5, D6 and D7 apply unchanged. The FAIL line names the CC, the coverage and the test files that run the function, worded as evidence, never as a target to reach (`agent-feedback.md` 3). Peers saw tests without assertions written only to raise coverage.

### D10. Cost

- **Wave 1** adds the counter's CPU: a few ms per changed file, and the first count once per repository and policy. It adds the grammar's bytes to each plugin.
- **Wave 2** adds about 8% CPU to each run Squeal makes while `coverage.enabled` holds, the mapping included, plus about 9 KiB of store per test file result. Measured on the research's 30-file sample (015-11, five pairs at load 18 to 48): median +5.4% CPU, one pair +25.5%; wall time median +0.2%; 26.7 KiB per test file here (amended 2026-10-24).
- Each coverage job, a writer job or a judging step, waits its own main-thread time before the next, so the change feed keeps time between them (amended 2026-10-25, 015-42, from 011-197). The records' writer and the coverage step share one pace, so their sum stays at about half of the main thread (amended 2026-10-25, 015-45).
- Neither adds a test run. The human (2026-10-23) weighs every feature by the CPU it adds per edit. Wave 2's dogfood reports the CPU per edit with and without coverage, with the load, before 015 ships.

## Testing

- **Counter.** A fixture with one construct per function, against ESLint's counts (`complexity-and-crap.md` `fixtures/constructs.ts`, `constructs.py`). A test over this repository's `src/` against stored ESLint counts at a pinned commit. Timing over `src/`.
- **Identity.** Rename with the same body, move across files, duplicate names, anonymous callbacks by call site, and a move plus an edit in one revision (reads as new).
- **States and delivery.** Registration shows the count line and no list. `PASS -> FAIL`, `FAIL -> PASS`, a first-seen fail, a removed failing function, the 5-line limit, a policy-change summary, the first edit to a standing failure (once, then quiet). With the policy off, every delivery stays byte-identical.
- **Store.** One count per blob across two worktrees; pruning; with the policy off no `code.sqlite` exists and the main store is untouched; the main store's `user_version` unchanged.
- **Integration.** A daemon on a fixture repository: switch the policy on, edit a function over the threshold, read the delivery from the Claude Code hook. The same through the Codex hook.
- **Wave 2.** A provider fixture with per-file payloads; the inspector fidelity rule (the research's `self-coverage.test.ts` passes under Squeal with coverage on); CRAP pending until every loader is current; the cost on the 30-file sample.
- **Proof.** A dogfood row per wave, in `lessons.md`. Wave 1: complexity on this repository and on cezar for a working day of agent sessions. It reports the transition rate per session, the deliveries that read as noise, identity losses and the counting cost. Wave 2: the same with coverage, plus CPU per edit against coverage off.

## Open questions

1. Count `?.`, `??` and defaults? ESLint counts them, and so does D3. Leaving them out drops 31% of the functions at CC 10 or more, but Squeal's number would then differ from every peer's. Owner: the human; wave 1's dogfood brings the noise count. Answered by the human, 2026-10-24: keep counting them.
2. Is "the first edit to a standing failure" (D6) useful or noise in practice? Owner: wave 1's dogfood. Answered for live sessions (015-10 part C, 2026-10-24, `lessons.md`): keep it, with row 015-19 fixed. Of 11 lines, 4 came from a pull (015-19), 2 were useful, 2 redundant, 3 noise; skipping lines whose count did not move would also cut a useful one.
3. How much of `src/` do tests reach only through child processes, so that those functions read "no test runs it"? Owner: wave 2's first row measures it here. Answered by 015-30, 2026-10-24 (`research/child-processes.md`): 50 of 7,582 functions (0.66%), a lower bound, 3 of them at CC 6 or more; collecting child coverage costs +13% to +16% CPU on child-heavy files and fails one test. Children stay out; the state is worded "no in-process test runs it"; `unknown` is never derived from static reach, which would hide 370 of the 377 functions no in-process test runs.
4. Is an immediate delivery noisy during a refactor made in several edits? A function can go over in one edit and back under two edits later, giving two lines that a test run, slower, would often skip. The view diff (011 C5) already drops a crossing that returns before the next delivery. If the dogfood shows noise, a crossing could wait until it holds across two edits. Owner: wave 1's dogfood. Answered for live sessions (015-10 part C, 2026-10-24): no churn in five multi-edit refactors; each `PASS` came with the last edit, so a two-edit hold would have withheld all five. Keep immediate delivery.
5. Does coverage stay noise-free on a wider sample, with timing-dependent tests? The research had 0 changes in 75,628 function states over two runs of 30 files. Owner: wave 2's dogfood.

## References

- Research: `research/coverage-collection.md` (015-01), `research/complexity-and-crap.md` (015-02), `research/agent-feedback.md` (015-03); briefs and probes beside them.
- Decisions: `status.md`, 2026-10-23.
- 011 C2 (revisions), C3 (keys, blob ids, reverse index), C4 (scheduler), C5 (transitions, delivery views), C6 (status), C7 (store, retention), C8 (hooks, Stop), C10 (policy, Fidelity); 013 (the Vitest adapter); 007 D4 (tree-sitter in the bundles); 002 (`interrupt.onRegression`).
- Row 013-07: a project's own coverage setting stays out of Squeal's runs (lands before wave 2).
- Vision: "Tests are the first check type, not the last"; principles 1 (silence), 2 (results tied to code state), 4 (use existing machinery, coverage data included).
