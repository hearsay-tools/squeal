# Issue 158: stop-mark failure under a write lock

Recommend a focused stop-mark failure outcome repair for human approval; keep the existing holds on related work.

The reported warning, success exit and generic persistence guidance reproduce on 0.1.414. The database contains **no stop mark** after the failed call. A short lock already recovers within SQLite's existing busy wait. The deciding tradeoff is truthful command completion versus a longer wait: extending retries alone would still leave exhaustion reporting wrong. This report proposes no retry duration or implementation design.

## Scope and evidence

Research on 2026-11-07, commit `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`, Squeal **0.1.414**, Node **v24.22.1**, Linux, 24 logical CPUs. The issue reported **0.1.409**; that version was not run. Initial `/proc/loadavg` was `13.11 7.91 7.28`; `getconf _NPROCESSORS_ONLN` returned `24`. The retained probe began at **22:41:21 Europe/Warsaw**, with load **17.52, 11.36, 8.62**, and ended with one-minute load **17.80**. Both gates allowed reproduction.

The committed `plugins/claude-code/dist/cli/squeal.mjs` and session runtime `/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs` have the same SHA-256:

```text
c44681839af3b88b9056327d1837c4bc7407c7e4b876d756991407cedfbba596
```

The experiment ran that committed CLI bundle directly, not the launcher. A fresh Git repository and SQLite store were used per case. A stand-in socket answered ping and stop and closed immediately. No real project daemon was stopped and no real project database was locked. This isolates the mark-write failure; it does not establish real-daemon shutdown behavior.

## Questions answered

All experiment and source-code tags below refer to **0.1.414 at the commit above**. Issue-document tags name their reported version.

| Question | Answer | Tag and version |
| --- | --- | --- |
| 1. Does a write lock reproduce #158? | Yes. Held through CLI exit: warning, success exit 0, generic flag guidance, absent mark after rollback. Also reproduces with no daemon socket. | verified by experiment, 0.1.414 |
| 2. Is there already a bounded wait? | Yes. Source sets `MARK_BUSY_TIMEOUT_MS = 2_000`. Releasing the lock 500 ms after the stop request succeeds; holding it gives failure after about 2.2 s including startup. No outer retry loop exists in `withStore`. | read in source code, 0.1.414; verified by experiment, 0.1.414 |
| 3. What state persists? | Both held-lock cases leave no mark. Transient and unlocked controls persist a JSON mark with `untilStart: true`. | verified by experiment, 0.1.414 |
| 4. Is this #108 or #147? | Distinct stop-side write failure. #108 concerns deleting the mark on start; #147 concerns a socket still serving after 60 s. | read in official docs (issue reports), #158: 0.1.409, #108: 0.1.359, #147: 0.1.390; read in source code, 0.1.414 |
| 5. Does a later hook actually restart this fixture? | Not determined, because no hook or real daemon was launched. Source says a missing mark does not hold the daemon stopped. | read in source code, 0.1.414; actual restart not determined |

## Results

Exact argv, environment, stdout, stderr, exit status and raw persisted values are in [output.jsonl](probes/issue-158/output.jsonl). Every mark was absent before its case. `BEGIN IMMEDIATE` held the write lock on the fixture store; `ROLLBACK` released it without writing any mark itself.

| Case | CLI duration | Exit | Mark after release | CLI result |
| --- | ---: | ---: | --- | --- |
| Stand-in socket; lock held through exit | 2,252 ms | 0 | Absent | Lock warning and generic flag guidance |
| Stand-in socket; release 500 ms after stop request | 731 ms | 0 | `untilStart: true` | No stderr; says it stays stopped until start |
| Stand-in socket; no lock | 154 ms | 0 | `untilStart: true` | No stderr; says it stays stopped until start |
| No daemon socket; lock held through exit | 2,158 ms | 0 | Absent | Same warning and generic guidance, prefixed “No daemon running” |

**Verified by experiment, 0.1.414.** The first case's exact output was:

```text
stderr:
squeal: could not record the stop, so a hook may start a daemon again: database is locked
stdout:
Squeal daemon stopped for /tmp/sq158-kb0vOO/repo; `squeal stop --until-start` keeps it stopped through edits and Git operations
exit: 0
persisted mark after rollback: null
```

The guidance is generic advice about the flag, not the stronger success wording “it stays stopped until ...”. Nevertheless, it recommends the flag that this call already used, while returning success with no mark. The short-lock control proves a transient lock is not always a failure.

**Read in source code, 0.1.414.** `src/cli/stopped-mark.ts:12` sets the 2-second busy timeout. `withStore` runs the write in one transaction and catches its error. `leaveStoppedMark` returns `untilStart: false` on error. `src/cli/stop.ts:156` prints the warning but returns only that boolean. Both success paths, lines 76–79 and 114–115, return 0 regardless of the mark error. `stoppedClause` chooses the generic advice when the boolean is false. This explains the observed output without relying on host saturation.

**Read in source code, 0.1.414.** `src/core/presence/events.ts:156` writes the mark into `meta`. `src/core/delivery/stopped.ts:45` returns false for a missing mark and true for an `untilStart` mark. Thus the failed write leaves no persistent-stop protection through that mechanism. Actual hook spawning was not tested.

**Read in official docs, checkout commit above.** Spec 011 C9 and its 2026-10-26 amendment say `--until-start` persists through edits, Git operations and heartbeats until start. C13 describes bounded busy-store handling; its explicit 10-second CLI retry contract is for `squeal retry`, not a stop-mark deadline. `status.md` records row 011-254's success wording and store-creation decision. This report does not invent a stop-specific retry duration from that separate contract.

## Related reports and open questions

**Read in official docs (issue reports).** #108 reports start printing “could not clear the stop mark” and exiting 0 on 0.1.359. It shares `withStore`, but calls `clearStoppedMark` to delete state. Its human deferral remains unchanged. This experiment did not run start. #147 reports a still-serving socket after the 60-second wait on 0.1.390. Here the stand-in closed at once and the failure occurred at the later mark write, so this is not evidence for that timeout.

Not determined: the original 0.1.409 lock holder, its transaction duration, whether a mark predated that incident, and any actual restart after it. This probe began without a mark; it does not cover an existing ordinary or persistent mark. It does not measure real-daemon cancellation, process cleanup, or higher-load behavior. No full suite, product build or product test suite was run: only the bounded standalone probe. No product files changed.

## Commands and sources

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue view 158 --repo hearsay-tools/squeal --json title,body,comments,url
gh issue view 108 --repo hearsay-tools/squeal --json title,body,state
gh issue view 147 --repo hearsay-tools/squeal --json title,body,state
git rev-parse HEAD
node --version
node --disable-warning=ExperimentalWarning plugins/claude-code/dist/cli/squeal.mjs --version
sha256sum plugins/claude-code/dist/cli/squeal.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs
pnpm exec tsx docs/specifications/011-core/research/probes/issue-158/probe.ts > docs/specifications/011-core/research/probes/issue-158/output.jsonl 2> docs/specifications/011-core/research/probes/issue-158/probe-stderr.txt
```

The probe command exited 0; its own stderr file was empty. A separate JSON check verified both exhaustion outcomes and both successful controls. `git diff --cached --check` passed. The affected-file check below exited 3: no test closure includes either research path. At revision 12 it reported 0 known failures and 529 unknown of 1,490 test files, so it supplies no test verdict for this probe.

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-158.md docs/specifications/011-core/research/probes/issue-158/probe.ts
```

 The script contains the exact Git setup commands, SQL lock/query and child command. [Probe README](probes/issue-158/README.md) explains isolation and cleanup; [probe.ts](probes/issue-158/probe.ts) is rerunnable with installed dependencies.

Sources fetched/read on 2026-11-07:

- [Issue #158](https://github.com/hearsay-tools/squeal/issues/158), body and recurrence comment; [#108](https://github.com/hearsay-tools/squeal/issues/108); [#147](https://github.com/hearsay-tools/squeal/issues/147).
- [Spec C9/C13](../spec.md), [amendment log](../status.md), and `docs/board.md` entries gh-108 and gh-147 at the examined commit.
- [stop.ts at examined commit](https://github.com/hearsay-tools/squeal/blob/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1/src/cli/stop.ts), `src/cli/stopped-mark.ts`, `src/cli/start.ts`, `src/core/presence/events.ts`, `src/core/presence/stored.ts`, `src/core/delivery/stopped.ts`, `src/core/store/connection.ts`, `src/core/store/paths.ts`.
- `test/cli/stop-mark.test.ts` supplies the existing stand-in-socket fixture pattern; it was read, not run.
