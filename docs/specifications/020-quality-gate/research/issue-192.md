# Issue #192: the one-shot gate drops completed results under a held store write lock

Research for hearsay-tools/squeal#192 (reported on 0.1.440, 2026-11-12).
Inspected at `edc289eab` (0.1.442). The gate's keep path is the same in
both: `git diff --stat squeal--v0.1.440 HEAD` over
`src/core/code/gate/`, `src/core/store/{sliced-write,busy,connection}.ts`
and `src/cli/code-gate-stored.ts` is empty.

Verdict: **reproduced.** When another process holds `store.sqlite`'s
write lock for longer than 10 s, `squeal code --base` gives the correct
verdict, waits 10 s, and keeps none of the files it completed. The next
run reruns them all and has no stored durations. A lock freed inside the
10 s keeps every file. The message does not name the holder, although
the code that names holders exists and named the probe's holder.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the gate lose completed results under a held write lock? | Yes: 5 of 5 not kept, same message text as the issue | verified by experiment |
| 2 | Is the final verdict still correct? | Yes: `pass`, exit 0, in all three cases | verified by experiment |
| 3 | Does a short lock recover? | Yes: lock freed 3.4 s after start, all 5 kept, next run reads 5 from the stores | verified by experiment |
| 4 | Unlocked control | All 5 kept, next run reads 5 from the stores | verified by experiment |
| 5 | What does a loss cost? | The next run reruns every lost file and has no stored duration; the losing run itself ends about 10 s later | verified by experiment |
| 6 | Can the holder be named? | Yes on Linux: `lockHolders` named the probe's holder pid and command; the gate's message does not call it | verified by experiment; read in source code |
| 7 | Who held the lock in the issue? | Not determined, because nothing recorded it. Source rules out only this worktree's own daemon | read in source code |
| 8 | Why 4 files in the issue, not 5? | Not determined, because the issue's stores and run are not available | — |
| 9 | Does row 021-20 fix this case? | Not alone: the issue ran with no daemon serving the worktree, where D15 still writes directly within D1's bound | read in docs |

## Host and commands

Host: 24 CPUs. One-minute load before the probe runs: 12.01 and 11.55
(below 24, so the probes ran). Probe runs started 2026-11-12 01:42:46Z
and 01:43:15Z. The second run is the evidence below; the first was the
same probe with its log hidden by Vitest.

    ISSUE192_OUT=/tmp/c3622693-ev.txt node_modules/.bin/vitest run \
      --config docs/specifications/020-quality-gate/research/probes/issue-192/vitest.config.ts

The probe (`probes/issue-192/gate-lock.probe.ts`, throwaway) runs the
gate in process through the test kit's `code` (`test/cli/code-gate-fixture.ts`),
the CLI's own `codeCommand`, with `--base main --json`. Each case uses a
fresh scratch git repository under `os.tmpdir()` with five node:test
files and complexity and coverage on, with `src/math.mjs` edited in the
working tree, and an own `HOME` and `TMPDIR` (`ownHomeAndTmp`). The lock
holder is a child `node` process that runs `BEGIN IMMEDIATE` on the
scratch repository's `.git/squeal/store.sqlite` and holds it until told.
No shared store was opened. Raw output: `probes/issue-192/evidence-2026-11-12.txt`.

## Findings

**Q1, Q2, Q5: held lock (verified by experiment).** The child held the
lock through the whole first gate run.

| Run | Exit | Verdict | Wall time | `from` | stderr |
|---|---|---|---|---|---|
| control, first | 0 | pass | 712 ms | none | 5 to run; no stored duration |
| control, second | 0 | pass | 226 ms | 5 × `store` | 5 of 5 read from the stores |
| held, first | 0 | pass | 10 853 ms | none | 5 to run; `5 completed test files were not kept in the stores: the store stayed busy for 10 s (another connection held its write lock)` |
| held, second (lock free) | 0 | pass | 1 827 ms | none | 5 to run; no stored duration, so the time is unknown |
| short, first (freed at 3 418 ms) | 0 | pass | 3 507 ms | none | 5 to run; no note |
| short, second | 0 | pass | 324 ms | 5 × `store` | 5 of 5 read from the stores |

The verdict is right in every case. What is lost is the cache write: the
results and durations of files that ran and passed. The issue's cost
statement holds. One cost the issue does not name: the losing run ends
about 10 s later, because the keeper writes after each runner's run and
before the report (`collect.ts:193`, `tellRan`), and waits its full
bound (`keep.ts:188-195`).

**Q3: short lock (verified by experiment).** The gate's run took under
1 s, and the lock was freed at 3.4 s; the gate ended at 3.5 s. So the
write waited about 2.5 s under the lock, then kept all 5 files. The
existing Keeper-level tests cover the same two outcomes with an
in-process holder (`test/code/gate/keep.test.ts:218` and `:232`); this
probe repeats them through the CLI with a holder in another process.

**Why all files go (read in source code, `keep.ts`).** `#write` takes
one deadline per runner run, `now() + BUSY_BOUND_MS` (10 s,
`store/sliced-write.ts:10`), and writes the files one by one. For each
file it writes the coverage record to `code.sqlite` first, then the
results to `store.sqlite` (`keepFile`, lines 243 and 257). The first
file whose write is still busy at the deadline ends the run's writes,
and the note counts every file not yet written (`files.length - written`).
There is no retry after the report and no queue for a later run. Inferred,
not checked: with only `store.sqlite` held, the first file's coverage
record lands in `code.sqlite` without its results; the comment at
`keep.ts:150-157` says no reader takes such a record and prune removes it.

**Q6: naming the holder.** Spec 021 D5 names holders in D1's busy
messages, through `lockHolders` and `describeHolders`
(`src/core/store/lock-holders.ts`), used by `src/cli/store-writes.ts:84`.
The gate keeper does not use them: its message is fixed text
(`keep.ts:193`). During the held case the probe called
`lockHolders(database)`, which returned the child's pid (`817894`, not
the test process `816456`) and command, `waiting: false` (verified by
experiment).

**Q7: the issue's holder (read in source code, not identified).** The
busy note is reached only after `acquireDaemonLock` on this worktree's
lock file succeeds (`keep.ts:163-167`); otherwise the note says a daemon
runs in this worktree. So this worktree's own daemon did not hold the
worktree lock at that moment. Which connection held the store's write
lock is not recorded anywhere this research could read. This report does
not guess it.

**Q8: 4 of 5.** The note counts the keepable files not yet written.
Either one of the 5 was not keepable (`#keepable` drops files without a
record, with observed reads beyond the key, with an unkeyed environment
file, or with inputs that moved during the run, all silently), or one
file was written before the lock was taken. Not determined, because the
issue's stores and the run's inputs are not available.

**Q9: row 021-20 (read in docs).** Spec 021 D15: "They write the store
directly only when no daemon serves, with D1's bound." Row 021-20 moves
the keeper's writes to the daemon when one serves the worktree. The
issue ran with no daemon in that session, and the source shows the
worktree's daemon lock was free. So 021-20 alone leaves this case as it
is; it needs a D1-style direct write that names the holder (D5) and
either a longer or later retry.

## Recommendation for Squeal

The verdict is safe; the defect is lost cache writes and a silent 10 s
delay. Two parts, smallest first:

1. Name the holder in the keeper's busy note, as D1's commands do:
   append `describeHolders(lockHolders(storePaths(commonDir).database))`.
   The parts exist and work on Linux. It answers the issue's second ask.
2. Do not spend the bound before the report. Options for the spec, not
   decided here: retry the writes after the report is printed with a
   longer bound; or carry the not-kept files into row 021-20's daemon
   request when a daemon serves, and into a direct write after the
   report when none does. Either keeps the verdict's latency unchanged.

## Open questions

- Who holds the shared store's write lock for more than 10 s in the
  cezarion repository? The lock watch of spec 021 D16 or `squeal ps
  --locks` during a gate run would show it.
- Should the note say the cost ("the next run reruns these 4 files")?
  A wording choice for the spec.

## Limits

- One probe run per case, on one host, at load about 12 on 24 CPUs.
- The holder was a bare `BEGIN IMMEDIATE`, not a daemon or a second gate.
- The probe used node:test, as the issue did; Vitest runs were not tried.
- No daemon ran in the scratch repositories, as in the issue.
- The 0.1.440 build was not run; the source is unchanged since it.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/192 (read with `gh issue view 192 -R hearsay-tools/squeal`).
- Source at `edc289eab`: `src/core/code/gate/keep.ts`, `src/core/code/gate/collect.ts:193`, `src/core/code/gate/stored.ts:90-138`, `src/core/store/sliced-write.ts`, `src/core/store/busy.ts`, `src/core/store/lock-holders.ts`, `src/cli/store-writes.ts:84`.
- Tests: `test/code/gate/keep.test.ts:169-245`.
- Specs: `docs/specifications/020-quality-gate/spec.md` D11.7 (line 191) and D17.3 (line 274); `docs/specifications/021-remote-store-and-execution/spec.md` D1, D5, D15; its `status.md` line 33; `docs/board.md` row 021-20.
- Probe: `research/probes/issue-192/` (README, `gate-lock.probe.ts`, `vitest.config.ts`, `evidence-2026-11-12.txt`).
