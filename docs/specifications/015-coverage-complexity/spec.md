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

1. Off by default. With `complexity.enabled` unset or `false`, Squeal counts nothing, writes no new store rows, and every delivery, status and exit code is byte-identical to the release before (D1).
2. When it is on, every function in the included files has a known complexity state, `pass` or `fail`, with the revision and blob it was counted at. Squeal's count equals ESLint's `complexity` rule (classic variant) on every `src/` file of this repository, and radon's on the research's Python corpus (D3).
3. A function that goes over the threshold, or a new function that starts over it, is delivered the way a test failure is delivered. A function that goes back to the threshold or under it is delivered as a recovery. A change of the count while the function stays over is quiet (D5, D6).
4. A registration shows the number of functions over the threshold and the command that lists them, never the list (the human, 2026-10-23, "don't flood the agent") (D6).
5. The first edit in a session to a function that is already over, and that leaves it over, delivers one line about it, once per session (D6, its own row).
6. A move or a rename that keeps the function's body keeps its state and delivers nothing (D2).
7. Complexity never denies a tool call, never counts in `Known failures`, and never blocks Stop, unless `complexity.blocking` is `true` (D7).
8. Cost: the counter runs only on files a revision changed. A changed file costs at most 5 ms at the median and 20 ms at p95 on this repository's files. The first count of this repository's included files takes at most 5 s of CPU. A second worktree at the same files counts nothing again, because results are shared by blob through the store (D4).

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
| `complexity.blocking` | `false` | D7. |
| `coverage.enabled` | `false` | Wave 2, D8. Needs `complexity.enabled`. |
| `crap.threshold` | `30` | Wave 2, D9. Savoia's threshold and php-code-coverage's default. |

These are never counted: test files (any file a runner lists), files under `node_modules`, files git ignores, and files over 512 KiB. A file over 512 KiB is named once in a note. The watcher already gives Squeal the set of files it sees (011 C2).

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

`?.`, `??` and defaults make up 31% of the functions at CC 10 or more here. They are counted, because that is the number ESLint and the peer tools show. Open question 1 records the choice.

A file that does not parse completely has an `unknown` state for each function in its error ranges. It is named in `squeal code`, and it delivers nothing.

### D4. Storage and the daemon's pass

**Counts.** Counts are stored by `(blob id, language, COUNTER_VERSION)`, the blob id being 011 C3's file hash. Each entry holds the file's functions: identity, range, body hash, CC and the count of decision points by kind. The entry depends on the bytes alone, so every worktree shares it through the store (C7) and nothing is counted twice. Retention follows C7: an entry no worktree's current file uses is pruned with old results.

**States.** The per-worktree known state of each code check is: state, value, threshold, the revision and blob it was counted at, and the revision it last changed state. Changes of state are recorded as transitions, as 011 C5 records them for tests.

**The pass.** On each revision the daemon counts the included files the revision changed (011 C2), after looking each blob up in the store. It runs in the daemon process, outside the scheduler's lanes, and takes no test permit (011 C10).

A revision with more than 200 changed files, for example a pull or a checkout, is counted in slices. Between slices the daemon serves requests and starts test tiers. Hooks read only the store; tree-sitter's 30 to 50 ms start happens once per daemon.

**The first count.** It runs at the first start with the policy on, and over the files that lack a count after a policy change. It is counted the same way, and status reports `counting: N of M files` until it is done.

### D5. States and transitions

A complexity check is `pass` when its CC is at or under `complexity.threshold`, and `fail` when it is above. A file Squeal has not counted yet has `pending`, and a parse error gives `unknown` (D3). 011 C5's transitions apply:

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

**Registration.** One line, only when the feature is on: `Complexity: 62 functions over 20; squeal code lists them.` While the first count runs: `Complexity: counting, 340 of 600 files.` No function is listed. The consumer's view is seeded with every current state, as 011 C5 seeds test states. Each failing function is marked as told by count only.

**A change.** A code transition is delivered with the test transitions of the same delivery, in the same FAIL and PASS block format:

```text
FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23, over 20 (ESLint rule)
PASS complexity: selectTier (src/core/scheduler/tiers.ts:120) is 18, at or under 20
```

A delivery holds at most 5 code transitions in full. The rest become one line: `and 14 more complexity changes; squeal code --changed lists them.` A test failure is always listed before a code transition.

**The first edit to a standing failure** (goal 5; its own row so it can be dropped if it proves complex). The counter knows which functions' own text a revision changed: their body hash moved and their identity stayed. A consumer is told about such a function once, in full, when all of these hold:

- the function is `fail` before and after the revision;
- the consumer's view holds it as told by count only.

The view entry is then marked told in full. Later edits to the function in that session are quiet until its state changes.

**A summary.** A policy change, or a counter version that changes states, delivers `Complexity threshold is now 15: 117 functions over; squeal code lists them.` and re-seeds the views by count.

**Status.** `squeal status` shows one line under the test lines: `Complexity: 62 functions over 20, 2 since this session started; squeal code lists them.` `--json` adds `code: { v: 1, threshold, over, sinceRegistration, pending, unknown }`.

**Details on demand.** These come from a new command, `squeal code`:

```text
squeal code [<path>...] [--changed] [--json]
```

- With no path, it lists every function over the threshold, newest first by the revision at which it went over. Each line gives the location, the CC, its decision points by kind and the revision.
- With paths, it lists every function in those files with its CC, over the threshold or not.
- `--changed` keeps the functions whose state changed since the consumer registered.
- `--json` gives a versioned shape. The command reads the store and needs no daemon, like `status` (011 C6).

### D7. Blocking

A code failure never denies a tool call: `interrupt.onRegression` (002) applies to tests only. It never counts in `Known failures: N`, and it does not block Stop.

With `complexity.blocking: true`, Stop's completion check (011 C8) also counts each code check that went to `fail` since the consumer registered. A function that was already failing at registration never blocks.

### D8. Coverage from Squeal's runs (wave 2)

With `coverage.enabled`, the Vitest adapter (013) passes `coverage: { enabled: true, provider: "custom", customProviderModule: <Squeal's own>, reporter: [], reportsDirectory: <the daemon's temp directory> }` to `createVitest`. In all other cases it passes `coverage: { enabled: false }`, so a project's own coverage setting never acts in Squeal's runs (row 013-07, which lands first).

**The provider.** Its worker side starts and takes V8 precise coverage through `node:inspector`, as `@vitest/coverage-v8` does. Its main side keeps each batch's payload and writes no report. Vitest gives one payload per test file while files are isolated (`coverage-collection.md` Q1).

**Mapping.** Each payload is mapped through the transform's source map to source lines and functions, outside the scheduler's path (0.37 s of main-thread CPU per test file).

**The record.** It holds, per source the test file loaded: the source's blob id, a bitset of covered lines and a hit bit per function range. That is about 9 KiB per test file. It is stored with the test file's result. Its key is the result's key plus the provider version, so it is adopted with the result (011-23) and pruned with it (C7).

**Fidelity** (the human, 2026-10-23, skip and name). A test file whose closure imports `node:inspector` or `inspector` is run with coverage off. If the provider cannot skip one file, the file runs in its own tier. Squeal reads that import with the lexer it already uses. Status lists those files, and a source that only they load reads coverage `unknown`. One test of this kind failed under V8 coverage in the research (`coverage-collection.md` Q5). 011 C10's Fidelity rule makes that a defect, never an accepted cost.

**`isolate: false` projects** run with coverage off, with one note. In a shared batch, import-time code is credited to the first file that loads it (Q1).

### D9. CRAP and "no test runs it" (wave 2)

**Joining coverage to functions.** A function's coverage is the union of the coverage records of the current results of every test file whose closure holds the function's source at its current blob (C3's reverse index). It is joined to the counter's functions by position, never by name: the body start for TS and JS, and Squeal's own ranges against line data for Python (`complexity-and-crap.md` 4).

**Two more states per function, beside complexity:**

- **`crap`**: `CC² × (1 − cov)³ + CC`, where cov is the share of the function's own statements that ran. A cov of 95% or more gives CC, as in PHPUnit. The state is `fail` above `crap.threshold`.
- **`uncovered`**: `fail` when no current test runs the function.

**Pending and unknown.** Each state is `pending` until every test file that loads the source has a current result with a coverage record. It is `unknown` while any of those files can have none: run before coverage was on, skipped by D8's fidelity rule, or a Squeal-excluded suite such as `test/e2e/**` here.

Without this rule, the first test file to finish after an edit would make CRAP read too high, and the agent would get a false failure (`agent-feedback.md`, feasibility). Under `baseline.onStart: lookup-only` a state can stay pending until `squeal run --all`. Status says which.

**Delivery.** D5, D6 and D7 apply unchanged. The FAIL line names the CC, the coverage and the test files that run the function, worded as evidence, never as a target to reach (`agent-feedback.md` 3). Peers saw tests without assertions written only to raise coverage.

### D10. Cost

- **Wave 1** adds the counter's CPU: a few ms per changed file, and the first count once per repository and policy. It adds the grammar's bytes to each plugin.
- **Wave 2** adds about 8% CPU to each run Squeal makes while `coverage.enabled` holds, the mapping included, plus about 9 KiB of store per test file result.
- Neither adds a test run. The human (2026-10-23) weighs every feature by the CPU it adds per edit. Wave 2's dogfood reports the CPU per edit with and without coverage, with the load, before 015 ships.

## Testing

- **Counter.** A fixture with one construct per function, against ESLint's counts (`complexity-and-crap.md` `fixtures/constructs.ts`, `constructs.py`). A test over this repository's `src/` against stored ESLint counts at a pinned commit. Timing over `src/`.
- **Identity.** Rename with the same body, move across files, duplicate names, anonymous callbacks by call site, and a move plus an edit in one revision (reads as new).
- **States and delivery.** Registration shows the count line and no list. `PASS -> FAIL`, `FAIL -> PASS`, a first-seen fail, a removed failing function, the 5-line limit, a policy-change summary, the first edit to a standing failure (once, then quiet). With the policy off, every delivery stays byte-identical.
- **Store.** One count per blob across two worktrees; pruning; migration from the previous schema (C7).
- **Integration.** A daemon on a fixture repository: switch the policy on, edit a function over the threshold, read the delivery from the Claude Code hook. The same through the Codex hook.
- **Wave 2.** A provider fixture with per-file payloads; the inspector fidelity rule (the research's `self-coverage.test.ts` passes under Squeal with coverage on); CRAP pending until every loader is current; the cost on the 30-file sample.
- **Proof.** A dogfood row per wave, in `lessons.md`. Wave 1: complexity on this repository and on cezar for a working day of agent sessions. It reports the transition rate per session, the deliveries that read as noise, identity losses and the counting cost. Wave 2: the same with coverage, plus CPU per edit against coverage off.

## Open questions

1. Count `?.`, `??` and defaults? ESLint counts them, and so does D3. Leaving them out drops 31% of the functions at CC 10 or more, but Squeal's number would then differ from every peer's. Owner: the human; wave 1's dogfood brings the noise count.
2. Is "the first edit to a standing failure" (D6) useful or noise in practice? Owner: wave 1's dogfood.
3. How much of `src/` do tests reach only through child processes, so that those functions read "no test runs it"? Owner: wave 2's first row measures it here.
4. Does coverage stay noise-free on a wider sample, with timing-dependent tests? The research had 0 changes in 75,628 function states over two runs of 30 files. Owner: wave 2's dogfood.

## References

- Research: `research/coverage-collection.md` (015-01), `research/complexity-and-crap.md` (015-02), `research/agent-feedback.md` (015-03); briefs and probes beside them.
- Decisions: `status.md`, 2026-10-23.
- 011 C2 (revisions), C3 (keys, blob ids, reverse index), C4 (scheduler), C5 (transitions, delivery views), C6 (status), C7 (store, retention), C8 (hooks, Stop), C10 (policy, Fidelity); 013 (the Vitest adapter); 007 D4 (tree-sitter in the bundles); 002 (`interrupt.onRegression`).
- Row 013-07: a project's own coverage setting stays out of Squeal's runs (lands before wave 2).
- Vision: "Tests are the first check type, not the last"; principles 1 (silence), 2 (results tied to code state), 4 (use existing machinery, coverage data included).
