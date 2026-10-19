# Issue 41: idle status and queued files

Recommendation: retain this as a status-explanation investigation; do not classify the 553 files as lookup-only baseline misses or approve a scheduler change without evidence from the incident's store.

## Scope and verdict

**Original incident not reproduced.** The reported wording is reproduced with seeded store rows and a synthetic edit-wait result. A real core scheduler with a synthetic runner does **not** label lookup-only misses queued, before or after an affected helper edit. This is a bounded negative result, not proof that the incident's scheduler was healthy.

Examined 2026-10-19, Squeal **0.1.222**, checkout `f96ce120300f69f1a1e0642f9ab2cfc3b756b308`, Node **v24.21.0**. Release tag `squeal--v0.1.222` resolves to `efcba0e0a22e55bcda84fe556240fa9956c18419`; the inspected status, scheduler, state, retry and wait-rendering sources have no diff from that tag. Initial load check at 15:08:34 UTC: **8.87 / 8.39 / 9.68**, **24 online CPUs**. The successful probe saw one-minute load **8.78**, **24 available CPUs**. Load permitted the cheap experiment. No full product suite or build ran; no product code, spec, status, skill or board changed. Existing holds stand.

The [issue body](https://github.com/hearsay-tools/squeal/issues/41) reports a fresh inherited cezarion worktree, shared e2e helper edit, revision 1 and 553 queued files on 0.1.222. Its [later comment](https://github.com/hearsay-tools/squeal/issues/41#issuecomment-6270190470) reports a retry described as waiting for load at 7.45 on 24 CPUs while already running. These are incident reports, not independently observed scheduler traces.

## Questions answered

All evidence below concerns 0.1.222.

| Question | Answer and evidence |
| --- | --- |
| Can the four reported phrases coexist? | **Verified by experiment, E1:** yes. Seeded `pending: "queued"` rows, no open runs, and a synthetic quiet edit-wait result produce all four. |
| Are ordinary lookup-only misses mislabeled queued? | **Verified by experiment, E2:** not in the isolated scheduler case. Three misses remain `pending: null`, `unknown: 3`, `pending: 0`; no baseline run occurs. |
| Does the helper edit turn untouched misses into queued work? | **Verified by experiment, E2:** no. Only the inherited file whose closure includes the helper runs; the other three remain unknown. |
| Does “Idle” establish scheduler idleness or a stall? | **Read in source code, S1:** no. The renderer checks stored counts and open runs, not the scheduler's in-memory queue, pump or its eligibility decisions. |
| Is edit quiet inconsistent with global pending? | **Read in source code, S2:** no. C6's unnamed wait covers its edit window and excludes unrelated baseline/backlog work. Global pending is separately reported. |
| Is the retry comment's load wording reproducible? | **Verified by experiment, E3; read in source code, S3:** yes at the formatter level. A load retry always gets the load-wait phrase, even with 7.45 below 24. Its actual running lifecycle was not reproduced. |

## Experiments and source evidence

**E2, real scheduler and store, synthetic runner.** A four-file fixture first warms one file in a base checkout. A new linked worktree lists all four with `baseline.onStart: "lookup-only"`. The scheduler inherits two result records for the warmed file (one test plus its file-level record), invokes the runner zero times, has `busy: false`, zero open runs and null phases for all four files. The three misses render:

```text
Idle: nothing is running and no run is open; 3 test files without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)
```

A helper edit submitted directly as a watch batch causes exactly `[["a.test.js"]]` in recorded runner calls. Afterwards `busy: false`, `runsOpen: 0`, `testFilesWithoutChecks: {pending: 0, unknown: 3}` and the same idle line remain. No scheduler error was recorded.

**E1, rendering control only.** After closing that scheduler, the probe replaces the unknown rows with 553 synthetic keyed queued rows. It passes a synthetic quiet wait with 91 selected files to the production formatter:

```text
Idle: nothing is running and no run is open; 553 test files without checks queued (`squeal run --all --wait` runs every test file without a result and waits)
Returned on quiet: nothing the edits since revision 1 re-keyed is pending (91 test files) at revision 1 after 0.0 s; 0 checks and 553 test files without checks pending in all. Worktree: known failures 0; checks 0 running, 0 queued; 553 test files without checks: 0 running, 553 queued
```

**S1.** `src/core/status/work-line.ts:14` calls a snapshot idle when discovery is complete, running counts are zero and no run is open. It does not inspect why work cannot start. `src/core/state/header.ts:200` counts a file without checks pending only when it has a key and a non-null pending phase. `src/core/scheduler/files.ts:96` initializes phase to null; `bootstrap.ts:140` settles without queueing misses, and its lookup-only branch at line 178 abandons the baseline checkpoint instead of enqueueing misses. `ledger.ts:489` persists the phase; `ledger.ts:625` derives it from the queue and running tier.

**Inferred, I1.** Ordinary lookup-only misses alone do not explain the incident's 553 queued count. The wording is evidence of stored pending state, not evidence that all 553 files were immediately runnable. Another worktree's live claim can hold queued work (`src/core/scheduler/claims.ts:46`); a renderer snapshot cannot decide whether this, a slow-lane constraint, a transient gap or a stopped pump applied. None was observed in the original worktree here.

**S2.** Spec 011 C4 distinguishes baseline lookup from explicit demand; C10 defaults to `lookup-then-run-missing` and offers `lookup-only`. C6 excludes unrelated baseline/backlog work from an edit wait. C15 distinguishes queued work, promotion and constraints; it does not make a wait a full-suite demand. `src/cli/status-wait-lines.ts:66` renders edit quiet independently of the global pending suffix, and its lines 323–355 render the phases and totals. The original worktree's configured baseline policy was not supplied by the issue.

**E3/S3, secondary comment.** `waitsText("load", {oneMinute: 7.45, cpus: 24})` returns:

```text
waits for the one-minute load average to fall below the CPU count (load average 7.45 on 24 CPUs now)
```

`src/core/retry/text.ts:20` does not compare load to CPUs. `src/core/status/format-status.ts:107` uses that phrase for pending load retries; `src/core/retry/pending.ts:19` selects unended retry records at current keys, without classifying their running phase. This proves misleading wording at a satisfied load threshold, not a scheduling failure.

## Commands, limits and next evidence

Commands used to establish the report and reproduce the probe, from the worktree root (probe paths relocated by the coordinator to the required owning-spec directory; the original run used `research/probes/issue-41/`):

```sh
uptime
getconf _NPROCESSORS_ONLN
node --version
git rev-parse HEAD
gh issue view 41 --repo hearsay-tools/squeal --json number,title,body,url,comments
git rev-parse squeal--v0.1.222
git diff --stat squeal--v0.1.222 HEAD -- src/core/status src/core/scheduler src/core/state src/cli/status-wait-lines.ts src/core/retry
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./docs/specifications/011-core/research/probes/issue-41/source-loader.mjs docs/specifications/011-core/research/probes/issue-41/probe.mjs
```

The tag diff was empty. The final probe exited **0**:

```text
PASS: lookup-only scheduler keeps misses unknown; queued wording requires queued stored rows in this probe.
```

Probe: `docs/specifications/011-core/research/probes/issue-41/{README.md,probe.mjs,source-loader.mjs,.gitignore}`. No dependencies were installed. Temporary Git and SQLite data is cleaned up. The heartbeat is seeded; there is no live fixture daemon. No Vitest, harness registration, real watcher, socket sync, actual 60-second CLI wait or cezarion suite is exercised. The 553 rows and 91-file edit-window result are deliberately synthetic. Probe-development assertion mistakes are recorded in its README.

The original incident's root cause remains **not determined**, because its policy, contemporaneous key phases, open runs, claimant heartbeats, daemon notes and selected-file pending reasons were not captured here. Those observations, ideally from the same `status --json --wait 60000` snapshot with named-file reasons, decide whether it was scheduled work held by a constraint or a stalled scheduler. The safe next decision is evidence collection and clearer status wording; this research authorizes no implementation.

Coordinator verification after relocating the probes to the owning-spec directory: the command above exited 0 at one-minute load **9.95 on 24 CPUs**, with the same final PASS line. `git diff --check` was clean. This documentation-only landing does not run full product suites or build.
