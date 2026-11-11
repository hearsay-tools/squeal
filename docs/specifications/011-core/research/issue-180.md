# Issue #180: narrow runs can answer before the edit is observed

Recommend one freshness contract for narrow-run answers and named status, covering both edit synchronization and revision listing.

## Verdict and scope

**Partly reproduced on 0.1.426.** A real daemon returned a passing narrow-run verdict at revision 0 immediately after a breaking source edit. At revision 1, the same three tests failed. Separately, an injected listing lag reproduced the reported “all current; none runs again” text with exit 3 and status reason `unlisted`. The natural revision-6 listing stall in Cezar was **not reproduced**.

The brief supplies two questions; Q3 checks what the source can establish. Every experiment below used Squeal **0.1.426**, tag `squeal--v0.1.426`, commit `c471793472c3eaf5e8a1b8801073a66053159c87`.

| Question | Answer | Evidence tag |
| --- | --- | --- |
| Q1. Can narrow run say current while status says unlisted? | Yes with injected listing metadata and real daemon results. Without `--wait`, exit 0; with `--wait 1000`, exit 3. The original natural stall is not determined because its store, JSON and exact invocation were not recorded. | verified by experiment, 0.1.426, synthetic state |
| Q2. Can an immediate edit/run race revision 0? | Yes. After changing the imported value from 1 to 2, the real CLI entry point returned exit 0 at revision 0 in 110 ms. Status later reported three failures at revision 1. | verified by experiment, 0.1.426, live daemon |
| Q3. Do the two command paths use the same freshness rule? | No. Narrow classification uses file state; the wait/status verdict also checks the listing marker. The narrow request does not first ask for the named-status synchronization pass. | read in source code, 0.1.426 |

## Method and exact commands

Run date: 2026-11-11. Host: Linux, Node **v24.22.1**, **24 CPUs**. Initial host check was one-minute load **16.02**. The retained probe began at **02:25:00 Europe/Warsaw**, load **16.44**; immediately before its live edit the load was **17.37**. All were below the CPU count. The probe checks this limit itself and skips live work above it.

```sh
gh issue view 180 --repo hearsay-tools/squeal --json title,body,comments,url
uptime
nproc
pnpm exec tsx docs/specifications/011-core/research/probes/issue-180/probe.ts \
  > docs/specifications/011-core/research/probes/issue-180/output.jsonl 2>&1
```

The script extracts `src` and `package.json` with `git archive squeal--v0.1.426`, loads that CLI's `main` with tsx, and starts the installed 0.1.426 daemon bundle. The bundle's SHA-256 equals the committed tag bundle: `7369dece504188c7ea265abdec4eca541b57ca48e4fc85842cdceb79fd79dc03`. Both `--version` and daemon ping report 0.1.426. No build or install runs.

The private temporary Git fixture has three node:test files importing `src/value.mjs`, each asserting `value === 1`. It uses the default `tests` group and lookup-only baseline, with coverage and complexity disabled. It uses a private runtime directory and store. The script restores the injected marker, stops its own daemon and deletes its fixture. No existing hold or daemon is changed. This uses node:test, not the original Cezar/Vitest project. The CLI entry point runs in process to expose the watcher window without a new Node process's startup delay; an ordinary spawned-shell invocation was not measured.

The raw log preserves every CLI argument, stdout, stderr, exit code and duration. Printed follow-up commands contain the temporary source module path because the CLI runs from source; those paths are not proposed user commands.

## Q2: live edit/run race

**Verified by experiment, 0.1.426.** First:

```text
run tests test/a.test.mjs test/b.test.mjs test/c.test.mjs --wait 20000
exit 0, 1137 ms
Selected test files of group tests completed at revision 0: no known failures; 3 test files, 3 queued by this request
```

The probe writes `export const value = 2;` and immediately calls:

```text
run tests test/a.test.mjs test/b.test.mjs test/c.test.mjs --wait 1000
exit 0, 110 ms
Selected test files of group tests completed at revision 0: no known failures; 3 test files, 0 queued by this request
Group tests at revision 0: these paths select 3 test files, all current; none runs again.
```

After 1200 ms, `status test/a.test.mjs test/b.test.mjs test/c.test.mjs --json` exits **1**. Its JSON has `revision: 1`, `refinedRevision: 1`, `knownFailureCounts.current: 3`, and `selection.result: "fail"`. Another narrow run exits 1 with those three failures. No store injection precedes this sequence. Thus the earlier pass does not describe the bytes already written when that command began.

## Q1: current/unlisted contradiction under injected state

**Verified by experiment, 0.1.426; injected state.** Restore `value = 1` and run `status --wait 10000` for the three files. It passes at revision 2. Change only this private store's `refined.<worktree-id>` marker from `2` to `1`. The scheduler's in-memory ledger and passing results remain unchanged. This isolates the two consumers' rules; it does **not** prove the real scheduler naturally leaves this marker behind.

```text
run tests test/a.test.mjs test/b.test.mjs test/c.test.mjs
exit 0, 105 ms
Group tests at revision 2: these paths select 3 test files, all current; none runs again.

run tests test/a.test.mjs test/b.test.mjs test/c.test.mjs --wait 1000
exit 3, 1010 ms
Selected test files of group tests have no verdict: the deadline passed with 0 test files pending at revision 2; their runs go on in the daemon
Group tests at revision 2: these paths select 3 test files, all current; none runs again.
```

The same response includes `revision 2 is not listed yet`. Named status JSON exits **3** with `revision: 2`, `refinedRevision: 1`, `runnerPartPending: true`, `selection.result: "none"`, `selection.reason: "unlisted"`, and three `current`/`pass` file entries. Its `runsOpen` is 0. The deadline wording “their runs go on” therefore also fails to describe this injected case. The marker is restored to 2 in `finally`.

The issue quotes exit 3 for a command without `--wait`. This probe observes exit 0 without it and exit 3 with it. The original complete argv or a wrapper is needed to settle that difference.

## Q3: source evidence and recommendation

**Read in source code, 0.1.426.** `Scheduler.requestGroupPaths` schedules runner work, selects files, calls `queueNarrow`, and returns `narrowAnswer`. `classify` uses phase, key, blocked state, unknown key and result key; it has no revision-listing argument. `queueNarrow` excludes `current` files. `narrowAnswer` counts those same files, and `narrowText` prints “none runs again” when all selected files are current.

`readHeader` separately compares `refinedRevision < revision`. `readClasses` exposes this as `unlisted`; `pollGroup` waits while it is true, and the verdict refuses a pass. Unlike named status, narrow-run handling performs no initial sync pass. These code paths explain the observed split, but do not establish why Cezar's revision 6 stayed unlisted. The narrow classifier, renderer, group wait and verdict files are unchanged between 0.1.426 and this worktree's 0.1.430 base; 0.1.430 was not live-tested.

**Inferred from the experiments and 011 C2/C4/C6/C15, 0.1.426.** Correct freshness is more important than returning an old pass quickly. A future approved change should cover both an edit already on disk before the request and a revision already registered but not listed. Keep valid key reuse, explicit group scope and existing holds. This is evidence for the coordinator's decision, not a design or authorization to implement.

Open questions: the natural listing-stall cause; the exact original argv; Vitest-specific behavior and normal spawned-CLI timing. No full suite, build, lint or typecheck was run: only throwaway fixture probes and evidence checks. The probe command exited 0; parsing its retained log confirmed the live stale pass, subsequent three failures, injected unlisted result and absence of config errors.

The worktree check used `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with this report and `probes/issue-180/probe.ts` as paths. It exited **3**: no test closure holds either path; known failures 0, 683 of 1598 test files unknown under lookup-only. This is not a suite pass. `git diff --cached --check` passed.

## Sources

- [Issue #180](https://github.com/hearsay-tools/squeal/issues/180), fetched with `gh` above; original report, not independently verified incident state.
- [Probe and instructions](probes/issue-180/README.md), [script](probes/issue-180/probe.ts), [raw outputs](probes/issue-180/output.jsonl).
- [0.1.426 scheduler request](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/core/scheduler/scheduler.ts), `requestGroupPaths`.
- [0.1.426 narrow selection](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/core/scheduler/narrow-run.ts), `queueNarrow` and `narrowAnswer`; [file classification](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/core/scheduler/files.ts), `classify`.
- [0.1.426 narrow CLI](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/cli/run-group-narrow.ts); [group wait](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/cli/run-group-wait.ts); [verdict](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/cli/verdict.ts); [header](https://github.com/hearsay-tools/squeal/blob/c471793472c3eaf5e8a1b8801073a66053159c87/src/core/state/header.ts). Read with `git show squeal--v0.1.426:<path>` and the extracted source used by the probe.
- Local contract: [011 spec](../spec.md), C2 watcher/sync, C4 key validity, C6 status, C15 named demand; [amendments](../status.md), including 011-206's unlisted verdict and 011-286's synchronization guard. Read at base `1ac649d408c9043997fd4eeb0c0ed3a079b1da4c`; left unchanged.
