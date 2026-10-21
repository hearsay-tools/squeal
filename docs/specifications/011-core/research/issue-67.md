# Issue 67: find one test file's failures and their test-file frame

Researcher findings for hearsay-tools/squeal#67, 2026-10-21. Squeal 0.1.235 source (`package.json`), branch `cez/4084a021` at `48c914667`; installed CLI 0.1.235. Host: 24 CPUs, 1-minute load 2.30 at start and 2.86 at the probe, below the CPU count, so the probe ran. Reproduction only. Nothing is designed or implemented. The existing holds stand.

**Verdict.** Reproduced in full on a synthetic store. Each of the three gaps holds on the current source:

1. `squeal failures` lists the newest 20 failures of the scope and takes no test-file, check or limit argument. A file whose failures are older than 20 others is not listed.
2. A failure's `location` and fingerprint name the first project frame. When a project helper throws, that is the helper frame. The frame in the check's own test file is kept only inside the stored `stack` text.
3. `squeal why <check>` lists the check's newest 20 results. When they are all passes, it shows no failure and no stack, though older failures of that check are still stored.

This is the specified behaviour (C6 caps `failures` at 20; C5 defines the location as one source location). The issue asks for a spec change, not a fix of a regression.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `failures` list only the newest 20, with no file, check or limit filter? | Yes. 32 stored failures: 20 listed, the target file's 2 not among them. `<test file>`, `--limit`, `--check` each exit 2 "unexpected argument". | verified by experiment, read in source code (0.1.235) |
| 2 | Does a helper-thrown failure name only the helper frame? | Yes. `location` = `test/harness-parity.testkit.ts:823:40`; the fingerprint ends with it. `test/harness-autosave.test.ts:84:15` is only in `stack`. | verified by experiment |
| 2b | Same in `why` and change notices? | `why` prints `Location:` from the known state and each listed result's full stack; notices print `at <location>`. No path names the test-file frame on its own. | read in source code (0.1.235) |
| 3 | Can `why`'s newest 20 be all passes while failures are stored? | Yes. 2 failures, then 22 newer passes: `why --json` returned 20 results, 0 fails; the human form has no `FAIL` line and no `84:15`. | verified by experiment |
| 4 | Was the recurrence's missing failure text (comment, cezarion#1323) caused by this issue? | Not determined, because no real store was opened (brief). The row was absent from `failure_texts` entirely, which a filter cannot fix. Issue 54's replacement by a later passing result at the same key, or the prune, are candidates. | inferred |

## Findings

### Q1. `failures` cap and arguments

- `src/cli/failures.ts:21-33` accepts only `--json`, `--all-worktrees`, `--since`, `--since=`; anything else returns usage, exit 2.
- `src/core/status/failures.ts:15` `FAILURES_LIMIT = WHY_RESULT_LIMIT` (20, `why.ts:41`). `readFailures` passes a filter of `{ worktreeId, since }` only to `store.results.listFailures` (`src/core/store/repos/results.ts:99`, `ORDER BY r.recorded_at DESC ... LIMIT ?`). The store has no file or check filter.
- The JSON entry has `check, worktreeId, worktreeRoot, revision, commit, dirty, recordedAt, durationMs, fingerprint, summary, runId`: no `location`, no errors. The human line prints the fingerprint, so the location appears only as its `@ path:line:col` tail.
- Spec 011 C6 (amendment of 2026-10-15) fixes the form: "`squeal failures [--all-worktrees] [--since <duration>] [--json]` lists stored failing results newest first, capped at 20 with the total".

### Q2. Location of a helper-thrown failure

- `src/runners/vitest/results.ts:24`: `error.stacks?.find((f) => paths.isProjectFile(f.file))`. `isProjectFile` (`src/core/fs/worktree-paths.ts`) excludes only paths outside the root and `node_modules`. A testkit in the project is a project file, so it wins.
- `describeFailure` (`src/core/state/fingerprint.ts:169`) builds the fingerprint as `<name>: <line> @ <errors[0].location>`. Spec 011 C5: "a diagnostic fingerprint (normalized first error line plus source location)".
- Tradeoff for the spec: changing which frame `location` names moves every such fingerprint. Per status.md (011-41 review, 2026-10-20) a fingerprint change asks for a `VITEST_ADAPTER_VERSION` bump, which re-keys results (the human's "results survive releases" rule). A separate field for the test-file frame, beside `location`, leaves fingerprints and keys alone. The stored `stack` already holds the frame, so it can be derived at read time for stored rows.
- node:test (`src/runners/node-test/run/errors.ts:98`) and pytest (`src/runners/pytest/run/report.ts:185`) have their own location rules; not probed.

### Q3. `why` window

- `src/core/status/why.ts:173-178`: `all = listForCheck(check, MAX)`, then `results = all.slice(0, WHY_RESULT_LIMIT)`. Every stored result of every key and worktree, newest first, cut at 20, with no preference for fails.
- `format-why.ts:219-245` prints each listed result's full stack, so the test-file frame is visible only when a failing result is in the window.

### Probe output (excerpt of `probes/issue-67/output.txt`)

```
== Q2 toCheckError.location: {"path":"test/harness-parity.testkit.ts","line":823,"column":40}
== Q2 fingerprint: AssertionError: expected 'idle' to be 'saved' @ test/harness-parity.testkit.ts:823:40
== Q2 stored stack keeps test frame: true
== Q1 failures --json: exit 0 total 32 listed 20 limit 20
== Q1 target file in list: false
== Q1 failures test/harness-autosave.test.ts: exit 2; squeal failures: unexpected argument "test/harness-autosave.test.ts"
== Q1 failures --all-worktrees --limit 100: exit 2; squeal failures: unexpected argument "--limit"
== Q1 failures --check autosave: exit 2; squeal failures: unexpected argument "--check"
== Q3 why results: 20 fail: 0
== Q3 why human exit 0 has test frame 84:15: false has FAIL line: false
```

### Commands and limits

```
cat /proc/loadavg; nproc                     # 2.30 / 24, then 2.86 before the probe
ln -s <other worktree>/node_modules node_modules   # untracked, removed after; no install, no build
node_modules/.bin/tsx docs/specifications/011-core/research/probes/issue-67/probe.ts
```

- The store is synthetic: a fresh `mkdtemp` directory under `$TMPDIR`, opened with `openStore`. No real `.git/squeal/store.sqlite` was opened or changed. No daemon, no Vitest run, no suite.
- The Vitest error is hand-built in `SerializedError` shape (`stacks` of helper, test file, `node_modules`). That real Vitest orders `stacks` innermost first was not re-measured here; the issue's own report (top frame `harness-parity.testkit.ts:823:40`) agrees.
- `node_modules` came from another worktree; its versions may differ from this lockfile. The code paths probed import no dependency beyond `node:sqlite`.

## Distinction from issues 54 and 55

- **54** (`research/issue-54.md`): a passing retry at the same key *replaces* the failing row, so the failure is gone from the store. **67** is about failures that *are* still stored but that `failures` and `why` do not reach (cap, no filter), and about which frame a stored failure names. 54 fixes would not add a filter; 67 fixes would not bring back a replaced row. The recurrence comment's missing text may be 54's case (Q4).
- **55** (`research/issue-55.md`): `why` is slow, from the O(n²) dedup in `resolve()`. **67** is about what `why` shows, not its speed. A test-file filter for `failures` should not reuse `resolve()`'s scan without 55's fix.

## Spec sections touched

- C6 (`squeal failures` form and cap; `why` result window, amendment 2026-10-15, task 001-409).
- C5 (location and diagnostic fingerprint; change notices' `at <location>` line).
- C7 (one read transaction per read; a new filter would add a store query; `failure_texts` storage).

## Recommendation for Squeal

Treat 67 as a C6 and C5 amendment for the human, in two parts: (a) `failures` gains a test-file or check filter and a limit, honoured with `--all-worktrees`, with a store query that filters in SQL; (b) a failure carries the first frame in its own test file as a separate field beside `location`, derived from the stored stack, so fingerprints and keys do not move. Decide with (a) whether `why` keeps the newest failing results visible when the 20-result window holds only passes.

## Open questions

- Which frame should a notice print first when both exist, and should the test-file frame show when it equals `location`?
- Q4: why the recurrence's failure text was absent from the store. Needs a read of that store, or the 54 and prune research.
- node:test and pytest: do their locations have the same helper problem?

## Sources

- `src/cli/failures.ts`, `src/core/status/failures.ts`, `src/core/status/why.ts`, `src/core/status/format-why.ts`, `src/runners/vitest/results.ts`, `src/core/fs/worktree-paths.ts`, `src/core/state/fingerprint.ts`, `src/core/delivery/format.ts:136,381`, `src/core/store/repos/results.ts:87-115`, at `48c914667`.
- `docs/specifications/011-core/spec.md` C5, C6, C7; `status.md` (011-41 review line).
- Issue: https://github.com/hearsay-tools/squeal/issues/67 (body and the 2026-10-21 comment).
- `research/issue-54.md`, `research/issue-55.md`.
- Probe: `research/probes/issue-67/probe.ts`, `README.md`, `output.txt`.
