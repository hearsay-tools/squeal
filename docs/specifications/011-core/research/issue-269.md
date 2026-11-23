# Issue 269: clean base moves and late notices

2026-11-23. Owner: spec 011 C2, C4, C5, C6 and C8. Text contract: spec 005 D6. Group timing: spec 019. Related evidence: [issue-261.md](issue-261.md), [issue-204.md](issue-204.md).

**Verdict: partially reproduced by a synthetic probe.** A clean watched revision can count as own edits, and its unresolved browser file can cause a late notice. Repeated late delivery did not reproduce when the probe recorded the first notice. The reported real checkout and three-hour hook sequence were not reproduced, because the cheap probe isolates delivery without starting a daemon or the original browser workload. This is not an end-to-end reproduction.

## Environment and commands

Issue [#269](https://github.com/hearsay-tools/squeal/issues/269) reports Squeal 0.1.604, Claude Code PostToolBatch, revisions 32 and 33, 97 on-request browser files unresolved. The local source examined was commit `7657caf7d`, package version 0.1.605. This session's registered runtime is 0.1.600; the probe imports source, not that runtime.

Exact commands:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git rev-parse --short HEAD
gh issue view 269 -R hearsay-tools/squeal --json body --jq .body
pnpm exec tsx docs/specifications/011-core/research/probes/issue-269/probe.ts
```

Host load before the probe: `0.67 0.26 0.23`, 16 CPUs. After: `0.34 0.23 0.22`. The skip condition did not apply. Probe exit code: 0. No test suite, daemon, Git reset or browser was run.

## Findings

| Question | Evidence and result |
| --- | --- |
| Can clean base changes be called own edits? | **Verified by experiment, source 0.1.605:** a synthetic watched revision with `head: new-base`, `dirty: false` and one re-keyed file produced `files: 1`, with one owed browser file. **Read in source code:** `delivery/own-count.ts:readOwn` checks changes and re-key records, without testing dirty state or the recorded HEAD; `registered.ts:changedAfter` classifies watched revisions as changed. A real clean checkout producing those exact store facts remains unverified. |
| Can a browser file count as late? | **Verified by experiment, source 0.1.605:** mixed-policy header (`noTestsAtEdit: false`), one owed `browser/a.test.ts`, age 180000 ms, returned `kind: owed`, `owed: 1`, `files: 1`. **Read in source code:** `late.ts` and `own-count.ts` do not filter individual files by group trigger. `quietFor` suppresses all late notices when no test group runs at edit; the all-on-request control returned null. Group discovery itself was not exercised. |
| Does every boundary repeat it? | **Verified by experiment, source 0.1.605:** after calling the first notice's `tell()`, the second call returned no late notice (`null`). **Read in source code:** `lateNotes` stores a consumer late slot and suppresses another late notice while it stays open. The report's repeated delivery requires more evidence about acknowledgement, consumer identity and restart handling; a repeated formatter string alone does not prove repeated delivery. |

Probe output, trimmed only to remove the empty Set serialization:

```text
clean watched base revision own count: since=0 revision=1 refined=true files=1
owed: project=browser path=browser/a.test.ts from revision 1
first late: kind=owed revision=1 owed=1 files=1 editRevision=1 ageMs=180000
second late: null
all groups on-request: null
```

## Decision input

**Inferred:** this fits the existing gh-261/gh-204 base-change policy row, with extra evidence about late-count eligibility and delivery repetition. Keep current-state honesty: a green CI commit alone must not stand for matching per-file results. The human must decide whether clean upstream-only changes are excluded from own-edit notices, whether on-request files are excluded from lateness, and whether to authorize a focused investigation of repeated delivery. Existing holds stand. No product change is authorized by this report.

Sources: issue #269; `src/core/delivery/{own-count,registered,late,late-timings,slots}.ts`; `src/core/scheduler/rekeyed-record.ts`; spec 011 C2/C4/C5/C6/C8; spec 005 D6. The preserved [probe](probes/issue-269/README.md) lists its limits and command.
