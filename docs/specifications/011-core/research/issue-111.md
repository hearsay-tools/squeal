# Issue 111: identify execution completion within a running tier

Recommend exposing per-file execution completion while keeping C4's final-verdict barrier.

**Verdict: reproduced.** A completed fast file and an unfinished slow file both read
as pending with the same aggregate `ended: 1`. A wait naming only the fast file
cannot identify the slow file holding its tier. This is a visibility gap, not
evidence that an early pass would be safe.

Researcher, 2026-10-27. All source findings below examine Squeal **0.1.365** at
`040450e1d2d7d2cdb09cfd097f56d3130784322c`. The live probe uses that checkout's
committed `plugins/claude-code/dist/cli/squeal.mjs`, Node **24.21.0**, Vitest **5.0.3**.
The examined scheduler, status-yield and Vitest paths, and that CLI bundle, have
no diff from tag `squeal--v0.1.365`. The incident also names 0.1.365.

## Questions and evidence plan

The brief supplies one question, expanded here into four bounded checks. The
plan was a two-file CLI experiment for Q1, local source at the commit above for
Q2/Q3, and the fetched issue plus that experiment for Q4. No open-web search.

| # | Question | Answer | Evidence type and version |
| --- | --- | --- | --- |
| 1 | Can named status identify which selected file ended and what remains? | No. Both files carry the same count; a fast-only wait still exits 3 without naming the slow file. | verified by experiment; 0.1.365 / Vitest 5.0.3 |
| 2 | Does Squeal know the identities before status reads them? | Yes. `RunOptions.fileEnded(ref)` populates `Tier.ended`; publication retains only its size per run. | read in source code; 0.1.365 |
| 3 | Does module completion prove a safe final verdict? | No. Later unattributed errors can invalidate the whole run; input, touch and completion checks still follow. | read in source code; 0.1.365 |
| 4 | Does this explain the original 14-file delay or name its last file? | Not determined, because the issue supplies no per-file end trace or run log. The smaller experiment proves the visibility gap only. | inferred; issue 111's 0.1.365 evidence |

## Q1. Live reproduction

**verified by experiment; 0.1.365 / Vitest 5.0.3.** At 05:39:32 UTC, load was
**0.1333 / 0.2085 / 0.1577** (1/5/15 minute), on **24 CPUs**. The one-minute
load was below CPU count. The script checks this before any live work.

```sh
gh issue view 111 --repo hearsay-tools/squeal --json number,title,body,comments,url,state
python3 docs/specifications/011-core/research/probes/issue-111/probe.py > docs/specifications/011-core/research/probes/issue-111/output.txt 2>&1
```

The probe command exited **0**. It creates an isolated two-file repository and
one foreground daemon. The fast file passes immediately. The slow file waits on
a marker. Observation and coverage are off. No real project's tests or daemon
are used. The full launcher paths and every CLI command are in
[output.txt](probes/issue-111/output.txt); [probe.py](probes/issue-111/probe.py)
contains the fixture and assertions.

While the slow file's start marker existed and its end marker did not, the named
JSON snapshot gave both entries `state: "pending", ended: 1`, with no verdict.
The pending-running list still contained both files. The two-file wait printed:

```text
Pending (2):
  2 in the vitest tier of 2 test files running since 06:39:33, 1 of them ended; ...
```

Both `status --wait 1000 test/fast.test.js test/slow.test.js` and
`status --wait 1000 test/fast.test.js` exited **3**. The fast-only line said:

```text
1 in the vitest tier of 2 test files running since 06:39:33, 1 of them ended
```

It named only `test/fast.test.js`, with no statement that its execution had ended
or that `test/slow.test.js` was unfinished. After release of the slow file,
`status --wait 20000 test/fast.test.js test/slow.test.js` exited **0** after **0.3 s**:
`2 test files, each with a current result`. The daemon stopped and the fixture
was removed. No full repository suite ran.

The first exploratory attempt used an invalid baseline value and ran no tests;
it exited 1 after the probe's bound. The error is retained in
[initial-config-error.txt](probes/issue-111/initial-config-error.txt). Correcting
the fixture to `lookup-then-run-missing` produced the result above.

## Q2. Where identity becomes a count

**read in source code; 0.1.365.** The path is:

1. `src/runners/vitest/reporter.ts:125` records `moduleEnd`; a requested module in
   a final state before cancel calls `fileEnded(ref)`.
2. `src/core/scheduler/tiers.ts:528` adds `testFileId(ref)` to `Tier.ended`.
3. `src/core/scheduler/yield-history.ts:62` publishes `tier.ended.size`, only for
   several-file tiers. `yield-row.ts:22` defines `ended` as a run-id-to-number map.
4. `src/core/status/standing-yields.ts:54` reads that number by run ID;
   `src/cli/named-file-lines.ts:256` repeats it on each named file entry.

The current field is a tier count, not a file's completion flag. This follows
011 C6/C15 and `status.md` amendment 011-209. Issue-91 research led to this count;
that older report's claim of no progress field no longer describes 0.1.365.

**read in source code; 0.1.365.** `yields.ts:219` and `yield-history.ts:62` also
limit writes to once per two seconds per worktree, skip a busy store, and have
no trailing timer. A final callback inside the window can remain unpublished
until another row write. Thus “not reported ended” does not always mean “still
executing”. `tier-text.ts:37` explicitly notes that the store cannot tell whether
each file in a several-file run has started.

## Q3. Execution completion and safe verdicts

**read in source code; 0.1.365.** `src/core/types/runner.ts:278` states that a file
named by the callback “may still be left out of `completedFiles` (a crash, a
withheld file)”. `src/runners/vitest/run.ts:207` turns an unattributed unhandled
error into `crashed`; line 214 says “Nothing in a crashed run is trusted”. Its
completed-file list becomes empty even if module-end events already arrived.

`adapter.ts:586` awaits execution before checking changed loaded bytes and
touches. `src/core/scheduler/record.ts:248` prepares environment and observed-input
evidence; its barrier at line 307 can withhold files. C4 explicitly says that
storing each file as its module ends “was not taken” because those checks and
run-wide failures can still change what is safe to store. These failure paths
were read, not injected in this probe. The experiment proves delayed publication
of a clean result, not the safety of publishing it earlier.

## Recommendation and open questions

**inferred from Q1–Q3; 0.1.365.** Treat this as a completion-visibility request.
Name execution ends separately from verdicts and explain when a completed file
still awaits the tier's final checks. Preserve uncertainty for missing or delayed
end reports. The deciding tradeoff is useful progress versus a false current
result; C4 and the crash path prove why the final-verdict barrier matters.
This finding proposes no implementation and changes no standing hold.

The original last file, the reason its tier took minutes, and the time any earlier
verdict would have saved remain unknown. The experiment covers a two-file initial
tier at revision 0, not the incident's 14-file tier at revision 10. Behavior when
all modules have ended but run finalization remains open was not live-tested.

## Sources

- [GitHub issue 111](https://github.com/hearsay-tools/squeal/issues/111), fetched
  with `gh` above on 2026-10-27; original reporter evidence, not independently
  verified timing for Cezar's incident.
- [011 spec C4/C6/C15](../spec.md) and [status amendment 011-209](../status.md).
- [Issue-91 research](issue-91.md), a lead from Squeal 0.1.292, and its probe.
- [Pinned Squeal source tree](https://github.com/hearsay-tools/squeal/tree/040450e1d2d7d2cdb09cfd097f56d3130784322c/src),
  exact paths and lines cited above; local files read in this checkout.
- [Throwaway probe and reproduction instructions](probes/issue-111/README.md).
