# Issue 59: a named wait with one unmatched path returns at once

Research for hearsay-tools/squeal#59, 2026-10-20. Documentation only: no product, spec, status or board edit. Code read at commit `dab2ef658` (package version 0.1.232). Live probes ran on copies of the installed plugins 0.1.232 and 0.1.231. Probes: `probes/issue-59/`.

**Host load before each live probe** (the one-minute load against 24 CPUs, from `/proc/loadavg` and `nproc`): 6.62 before `run.sh` on 0.1.232, 10.07 before `run.sh` on 0.1.231, 7.92 before `run-startup.sh` on 0.1.232. Every load was below the CPU count, so every probe ran. The parent's load at dispatch was 9.63. The research took about 5 minutes of wall time (253 s at the last probe).

**Synthetic reproduction and the original incident are different evidence.** The incident was in a cezarion task worktree on 0.1.231, with 30 paths. It is known only from the issue text. Squeal's store and outputs from it were not examined. The synthetic probes use a scratch repository with 2 test files (or 302) and one nonexistent path.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `status --json --wait` with a real pending test file and one nonexistent path return at once as `unmatched`? | Yes, on 0.1.231 and 0.1.232. It returns in 0.27 to 0.52 s (`waitedMs`; 0.36 to 0.63 s of wall time) with `outcome: "unmatched"`, exit 3, the real file `pending`, and no wait for it. Repeating the call gives the same result. | verified by experiment; read in source code |
| 2 | Does discovery or startup leave the unmatched path out of the answer? | Not reproduced. At startup (2 files, and 302 files) every call named `test/nope.test.ts` in `wait.unmatched` and in the stderr line, and listed the real file. The incident's first answer (all counts 0, no files) did not appear. | verified by experiment |
| 3 | What does the corrected selection do? | It waits for the edited file and settles: 8.3 to 9.4 s, `outcome: "settled"`, exit 0, both files `current`. | verified by experiment |
| 4 | Which code path decides it? | `waitForNamed` ends the wait with `unmatched` at the first ready read when any path is unmatched. That check comes before the pending check and before the promotion is sent. | read in source code |
| 5 | Why was the incident's first answer empty? | Not determined, because the incident's store and its full JSON were not kept. The code allows one explanation, given under Findings 2. | inferred |

## Findings

### 1. A mixed selection ends at once (verified by experiment, 0.1.231 and 0.1.232)

Command: `sh probes/issue-59/run.sh [plugin-dir]`. Each call is `squeal status --json --wait 60000 <paths>`, run from the repository root. `summarize.mjs` reduces the JSON. Outputs from 0.1.232 (`output-0.1.232.txt`; the 0.1.231 output in `output-0.1.231.txt` matches within 20 ms per call, except B1, which took 8.4 s):

| Call | Paths | Exit | Elapsed | `wait` |
|---|---|---|---|---|
| S1, right after `squeal start` | `test/slow.test.ts test/nope.test.ts` | 3 | 0.62 s | `unmatched`, `unmatched: ["test/nope.test.ts"]`, `slow: pending`, byClass `pending 1` |
| S2, same again | same | 3 | 0.37 s | same |
| A1, right after an edit to `slow.test.ts` (an 8 s test) | same | 3 | 0.39 s | `unmatched`, `slow: pending`, revision 1 |
| A2, same again | same | 3 | 0.38 s | same |
| A3, corrected | `test/slow.test.ts test/fast.test.ts` | 0 | 8.40 s | `settled`, both `current` |
| B1, corrected, right after an edit | same | 0 | 9.40 s | `settled`, both `current`, revision 2 |
| C1, the nonexistent path alone | `test/nope.test.ts` | 3 | 0.36 s | `unmatched`, `testFiles: []`, byClass all 0 |

The stderr line on every unmatched call is `No verdict: no test file's closure holds test/nope.test.ts.` followed by the worktree's clause. So the first half of the issue reproduces: one unmatched path ends a wait that the matched files still need. The other half (an answer that names nothing) does not.

Source (read in source code, `src/cli/status-wait-paths.ts` at `dab2ef658`):

- `selectNamedFiles` (line 80) puts every path with no hit into `unmatched` (line 104) and keeps the hits in `files`. The two lists are independent.
- `waitForNamed` (line 279) computes `ready` (line 310): the daemon is alive, its sync pass reached the read's revision, and the runner part is done. The outcome chain then puts `ready && selection.unmatched.length > 0 ? "unmatched"` (line 328) before `slow`, before `settled` and before the poll goes on. So the first ready read ends the wait, whatever the matched files' state.
- The promotion is sent only when the outcome is `null` (line 339). An unmatched wait never promotes its matched files (spec 011 C15).
- `namedCode` (line 388) gives 3 for every outcome except `settled`.
- `namedWaitCommand` always writes `wait.unmatched` (line 421). `src/cli/status-wait-lines.ts` prints no `Selected:` line (line 253) and no class lines (line 282) for `unmatched`. Its verdict line is `No verdict: <unmatchedText>` (line 180).

Spec (read in the spec): 005 D2 says "A path that selects nothing exits 3 with `no test file's closure holds <path>`". It does not say what happens to the other paths in the same wait. 011 C15 (amended 2026-10-20, row 011-24) adds that an unmatched path names its base directory and the root file it may mean. Neither text says whether the matched files are waited for. The behaviour follows the code. The spec does not decide the mixed case.

### 2. The startup window names the path (verified by experiment); the incident's empty answer is not reproduced

Command: `sh probes/issue-59/run-startup.sh` (0.1.232, 300 generated trivial files plus the 2 fixture files), output `output-startup-0.1.232.txt`. Eight calls from +0.29 s to +8.8 s after `squeal start`, with the same mixed paths. The first call waited 2.3 s, until the selection was ready (the listing and the sync pass), and then returned `unmatched`. Every call named `test/nope.test.ts`, listed `test/slow.test.ts: pending`, and exited 3. No call returned the issue's first shape.

Inferred, not verified: the issue's first answer had byClass all 0 and no per-file states. In the code that means `selection.files` was empty at a ready read. No `testFileKeys` row of the worktree matched any of the 29 real paths, so `wait.unmatched` would hold all 30 paths (line 104). A 30-path `unmatched` list names no single path at fault, which matches the report. Why the rows were missing at a read the code thinks is ready (for example a daemon restart or a re-key around the 0.1.231 install) is not determined, because the incident's store, its daemon log and the full JSON were not kept. The second call had the rows (2 current, 27 pending). So the gap was a short window, not a lasting state.

### 3. The corrected selection is the control (verified by experiment)

A3 and B1 above. Without the bad path the same wait holds for the 8 s test and ends `settled` at exit 0, as the issue reports for the incident.

## Recommendation for Squeal

The reproduced defect is the order of the outcome chain at `src/cli/status-wait-paths.ts:328`. The issue's first suggestion fits the code: hold for the matched files, report `unmatched` beside their verdict, and exit non-zero. It also gives the matched files their promotion, which they lose today. That choice belongs to a spec amendment of 005 D2 and 011 C15, since the current text decides only the "selects nothing" case. Also, a wait whose every path is unmatched while the worktree has no listed files may be a startup gap, not a typo. It should say so, and not report each path as unmatched. This needs the incident's cause first (open question 1).

## Open questions

1. Why did the worktree list none of the 29 real files at a read that `waitForNamed` found ready? Not determined. It needs a reproduction on a cezarion-sized worktree during a restart or re-key, or the store of a run that shows it.
2. Should `code` for "matched files settled, some paths unmatched" be 1 or 3, or a new value? This is a spec decision, not research.

## Limitations

The synthetic repository has 2 or 302 files and one Vitest project. The incident had a multi-project monorepo with 30 paths given by shell globs. The probes did not cover projects, a cwd below the root, or a source path.

## Sources

- hearsay-tools/squeal#59 (`gh issue view 59`, read 2026-10-20).
- `src/cli/status-wait-paths.ts`, `src/cli/status-wait-lines.ts`, `src/cli/named-file-lines.ts` (`unmatchedText`, line 181), `src/cli/verdict.ts`, at `dab2ef658`.
- `docs/specifications/005-agent-adoption/spec.md` D2 (line 63); `docs/specifications/011-core/spec.md` C6 and C15 (the 2026-10-20 amendment).
- Plugins `~/.claude/plugins/cache/hearsay/squeal/0.1.231` and `0.1.232`, copied into each probe's scratch directory.
- Probes and outputs: `probes/issue-59/` (`run.sh`, `run-startup.sh`, `summarize.mjs`, `fixture/`, `output-*.txt`).
