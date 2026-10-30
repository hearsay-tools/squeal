# Issue 129: unexplained unknown CRAP beside line coverage

Recommend explaining unknown CRAP in the path report while preserving D9's conservative judgement.

## Verdict and scope

**Verified by experiment, Squeal 0.1.378:** the synthetic symptom reproduces.
One current loader and one loader with a skipped test produce CC 20, 38/74
covered lines, `uncovered: pass`, `crap: { outcome: unknown, value: null }`, a
numeric sibling function, and no explanation in the path report's text or JSON.
The internal file summary knows `cause: skipped`. Completing that loader with
a current full record changes CRAP to 20.

This is **not proof of the original Cezarion cause**. The probe uses fabricated
counts and mapped records, one contributing test file rather than the issue's
176, and the existing isolated-store harness. It does not reproduce the original
source, collector, source maps, daemon timing, revision 7 or bundled fallback.
The original producer version was not recorded; the issue names 0.1.378 as the
current version. No original task or shared store was inspected.

Examined checkout: `d81ad16fbe282000f778f39cacd02f67235af5e3`, package 0.1.378,
Node v24.22.1, Vitest 5.0.3. Initial one-minute load: 5.16, 24 CPUs. Immediately
before the first probe at 2026-10-30T10:24:51Z: 4.72/24; before the recorded
repeat at 10:25:30Z: 5.07/24. Both passed the load gate. Product stayed read-only;
no build, full suite, shared-store mutation, default change or held work ran.

## Questions answered

| Question from the brief | Answer and evidence tag, version 0.1.378 |
| --- | --- |
| Can unknown CRAP coexist with nonzero line coverage and no reason? | Yes. **Verified by experiment:** the probe's assertions and saved text/JSON reproduce it. |
| Which unknown/pending rules permit it? | **Read in official docs** (repository spec D9) and **read in source code:** a skipped loader makes the source unknown; current records can prove a tested pass without proving CRAP below its threshold. |
| Where does the explanation disappear? | **Read in source code:** file summary retains `cause`; per-function projection copies states and evidence only; path mode omits the top-level coverage summary; text returns early on unknown CRAP. **Verified by experiment:** no cause survives in the report. |
| Is this the original Cezarion cause? | Not determined, because the issue lacks the original loader conditions and records. **Inferred:** skipped-loader partial judgement is a compatible explanation, not an attribution. |

## Probe and exact results

Read the issue with:

```sh
gh issue view 129 --repo hearsay-tools/squeal --json title,body,comments,url
```

It returned the reported symptom and no comments. The [probe README](probes/issue-129/README.md)
contains the exact load and run commands. The first run used the same command
without `--silent=false`: exit 0, one file/one test passed, 2.33 s. Its default
reporter hid passing-test logs. The repeat added that flag to preserve evidence:
exit 0, one file/one test passed, 3.06 s. No product suite was run. Squeal explicitly
reported no test closure for the two research TypeScript files.

Final checks: `git diff --check` passed. The command
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000`
with this report, `probe.test.ts` and `vitest.config.ts` as explicit paths exited
3 at revision 8: no verdict for these research files, zero known failures,
all 1,325 worktree test files current. These inherited/current results are not a
new suite run. `pnpm exec biome check` with the two probe TypeScript paths exited
1 because repository configuration ignores them: zero files checked, no lint
pass claimed. The direct probe is the validation of this research fixture.

**Verified by experiment, 0.1.378:** [result.txt](probes/issue-129/result.txt) records:

```text
src/a.ts:1  pumpWork  CC 20 (if 19), at or under; CRAP unknown
src/a.ts:76  other  CC 7 (if 6), at or under; CRAP 7; 100% of its lines ran in 1 test file
```

The first function's JSON contains `lines: 74`, `covered: 38`, `testFiles: 1`,
`uncovered: "pass"`, and `crap: { outcome: "unknown", value: null }`. It has no
`crap.reason`; the path report has neither top-level `coverage` nor `notes`.
Internally the file is `{ state: "unknown", cause: "skipped", ... }`.
The partial CRAP bound is `66.05452786606915`, above threshold 30. It cannot prove
a pass and must not prove a failure while coverage is incomplete. The sibling's
bound is 7 and can prove a pass. After replacing the skipped result with a new
key and complete record, the file is `judged` and `pumpWork` reads CRAP 20 with
100% coverage in two files. This is an isolated experiment, not a restart test.

## Rules and output seam

**Read in official docs and source code, 0.1.378:** D9 and `loaders.ts` distinguish
pending `imports`, `run`, and `record` from unknown `unkeyed`, `skipped`,
`no-record`, and `unread`. A missing record waits 36 s after its result and keeps
waiting while the writer is busy. Non-recording runners can make sources unknown
at once. A record that cannot confirm the source bytes cannot prove coverage.
An ambiguous function join can also make a function unknown, independently of
the file's loader condition. Thus a file cause alone cannot explain every unknown.

D9's early judgement uses every own line as the denominator, giving an upper
bound on CRAP. Ordinary early judgement passes prior failures only. The approved
015-78 skipped-test rule also permits first proven passes. A skipped loader's
own record is not used. Pending sources keep last judged states; unknown sources
with a changed loader set drop states that are not newly proven to unknown.
`status.md` records this rule and leaves analogous no-record work deferred.

The specific path through the code is:

1. `loaders.ts:conditionAt` detects the skipped result; `file.ts:fileCondition`
   selects `unknown/skipped` and preserves the ready loaders.
2. `walk.ts:judgeEarly` and `judge.ts:judgeMeasure` permit the proven untested
   pass. `dropKept` leaves unproven CRAP unknown. Evidence is stored per function,
   so evidence for the proven untested pass can sit beside unknown CRAP.
3. `summary.ts:FileSummary` retains the cause. `code-coverage.ts:coverageByFunction`
   projects only the measure states and function evidence, apart from the special
   non-recording-runner explanation. `CodeReportCoverageOf.crap` has no reason.
4. `code-report.ts:coveragePart` returns `{}` when paths are supplied.
   `code-coverage.ts:coverageWords` returns `; CRAP unknown` before coverage text.
   `code.ts:print` serializes that report unchanged for JSON.

The path command's short wait only handles uncounted changed source bytes
(`files[].reason === "pending"`), not unknown CRAP. `coverageStatusOf` aggregates
file causes for status, but that is not a per-function explanation. A blind wait
or restart is therefore not a demonstrated remedy. In this probe, removing the
skip and obtaining current complete coverage resolves the unknown; in another
case, ready records proving a sufficiently low bound could resolve it sooner.

## Recommendation and remaining limits

**Inferred from the experiment and source, 0.1.378:** treat this as an explanation
gap at the coverage-to-CLI boundary, not evidence that any positive line coverage
must yield a numeric score. The deciding tradeoff is truthful incomplete evidence
versus an actionable reason. Preserve the former and expose the latter. A spec
decision should distinguish file readiness from function join uncertainty and
say what evidence clears each condition. No interface or implementation is
designed here; existing holds remain in force.

Open: the original loader cause, record completeness, source-map joins, producer
version and effect of a restart remain unknown. The reported local 100% body
coverage may use different inputs or denominators; this probe does not compare
those tools. Evidence from the original task would decide attribution.

## Sources

- [Issue 129](https://github.com/hearsay-tools/squeal/issues/129), fetched 2026-10-30;
  user report, not independent proof of its historical cause.
- Repository [D6 and D9](../spec.md), [decision log](../status.md), at the checkout
  above; especially D9's 015-57, 015-75 and 015-78 amendments.
- [Pinned source tree](https://github.com/hearsay-tools/squeal/tree/d81ad16fbe282000f778f39cacd02f67235af5e3):
  `src/core/code/crap/{loaders,file,join,walk,judge,summary,status}.ts`,
  `src/cli/{code,code-report,code-coverage}.ts`, and
  `test/code/crap/rig.ts`, `test/code/crap/skipped-pass.test.ts`, and
  `test/code/crap/code-command.test.ts`.
- [Throwaway probe](probes/issue-129/probe.test.ts), [config](probes/issue-129/vitest.config.ts),
  [saved result](probes/issue-129/result.txt). Assertions exercise real judgement
  and report functions over temporary stores, with a fabricated counter and records.
