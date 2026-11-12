# Issue 202: command return waits after the gate report

Keep #202 as a command-lifetime decision linked to #201's retention decision.

**Verdict:** source confirms blocking after JSON; prior isolated experiments
show it with both successful retention and expired writes. A new reproduction
on the installed 0.1.457 CLI was **skipped** at load 31.92 on 24 CPUs.
The original other-worktree daemon and approximately one-minute delay remain
unverified. Earlier report delivery does not make the command return earlier.

Examined 2026-11-12. Reported and installed version: **0.1.457**, release commit
`49557fe0facdbe670664ed5e0146b662e346f169`. Fetched `origin/main` and research
checkout: `15c14ea2d8e3f77e3395a693a623f7bea5c883f4`, package **0.1.459**.
Owner: 020 D11.7/D17.3/D17.5; shared: 021 D1/D5/D15 and 011 C7.

## Questions and findings

| # | Question and evidence plan | Answer | Tag and version |
|---|---|---|---|
| 1 | Does JSON completion release the command? Read the gate and JSON wrapper. | No. The gate awaits its keeper after sending the report; the wrapper prints the report and awaits child exit. | read in source code, identical examined paths in 0.1.457 and 0.1.459 |
| 2 | Can contention delay return without losing results? Recheck #201's saved measurements; attempt a tiny installed-CLI probe. | Yes in the prior source probe: 2,738 ms after the report, then all five files reused. New installed-CLI attempt skipped at load 31.92 > 24. | verified by experiment, reused 0.1.459 source evidence; installed 0.1.457 reproduction not determined |
| 3 | What bounds the wait? Read the keeper and compare exhaustion evidence. | Busy retry has a 30 s bound from the first refused write. Prior measured report-to-return delay was 30,635 ms. This is not an end-to-end command deadline. | read in source code, 0.1.457/0.1.459; timing verified by experiment, reused 0.1.459 evidence |
| 4 | Why another worktree's daemon? Read store layout and writer selection. | Worktrees share the git-common-dir SQLite store. A local direct keeper write can contend with another worktree's writer even when no daemon serves the gate's worktree. The original holder's operation and duration are not determined without its logs. | read in source code for the mechanism; inferred for the reported 0.1.457 incident |
| 5 | Did newer main fix this, and is it #201? Diff the named paths and compare the two reports. | No newer change in the examined gate, keeper, routing or retry paths. #201 concerns losing completed evidence; #202 concerns return delay, which also occurs when evidence is kept. | read in source code for the diff; inferred for issue classification, 0.1.457 to 0.1.459 |

### Return path and bounds

**Read in source code, 0.1.457/0.1.459.** In
`src/cli/code-gate.ts`, `afterReport.push(collected.keep)` registers storage;
`codeGateCommand` runs `for (const step of afterReport.splice(0)) await step()`
in `finally`. `code-gate-stored.ts` awaits `stored?.flush()` before closing
stores. For the actual `--json` CLI, `code-gate-relaunch.ts` sends a complete
frame from the child, prints it in the parent, then executes
`const end = await exited`. Thus seeing complete JSON proves report delivery,
not process completion. The exit code also remains subject to the child's
actual exit; D17.5 requires exit 3 when that child ends on a signal.

**Read in source code, 0.1.457/0.1.459.** `keep-write.ts` sets
`KEEP_BUSY_BOUND_MS = 30_000`. Its `StoreWait` starts on the first busy
refusal, not at report delivery. `keep.ts` shares that wait across queued
files. Before it, the keeper checks inputs and opens stores. Direct writes
use short busy slices; a serving daemon instead receives requests through
`keep-sent.ts`. That path also has socket-answer and reconciliation waits.
The 30 s busy bound therefore must not be advertised as a strict total time
from JSON to exit. None of these facts proves the reported extra minute.

**Read in source code, 0.1.457/0.1.459.** `store/paths.ts` places the database
at `<git-common-dir>/squeal/store.sqlite` and uses a separate per-worktree
singleton-lock file. `Keeper.#write` selects direct writes when it acquires
that singleton lock; otherwise it may route to a fresh serving daemon.
These are distinct locks. A store holder in another worktree neither proves
a singleton-lock fault nor identifies the operation responsible for contention.

### Prior experiment reused, new experiment skipped

**Verified by experiment, prior source 0.1.459 at
`d3d40f583e22c2149469d6751ed6837a63072575`.** [Issue 201](issue-201.md)
ran five tiny node:test files with temporary repositories and stores. A child
held `BEGIN IMMEDIATE` on the scratch store. The measurements below are from
its committed [raw evidence](probes/issue-201/evidence-2026-11-12.txt), not a
new live run. Return means the in-process CLI promise resolved; that probe
did not exercise the packaged JSON wrapper or measure OS process exit.

| Case | Complete report | CLI return | Report to return | Next run |
|---|---:|---:|---:|---|
| Unlocked | 980 ms | 1,042 ms | **62 ms** | 5/5 from store |
| Lock freed at 3,375 ms | 927 ms | 3,665 ms | **2,738 ms** | 5/5 from store |
| Lock held past bound | 978 ms | 31,613 ms | **30,635 ms** | 0/5 from store |

Every listed first run reported pass and returned 0. The short hold printed
`the store was free after 2.4 s: 5 completed test files kept`. This separates
return blocking from retention loss. The exhaustion case printed that five
files were not kept and would run again. The original #201 probe command
exited 1 because two reuse assertions treated a map as an array. Its corrected
offline evidence verifier passed again in this investigation; it does not
turn that earlier live run into a passing suite.

**Verified by experiment, probe admission only, installed 0.1.457.** Initial
load samples were 22.18 and 20.77 with 24 online CPUs. The probe's immediate
check at 2026-11-12 21:42:09Z was **31.92**. It printed the installed version,
then skipped before creating any fixture, runner or lock. Node was v26.13.0.
The throwaway [probe and skip log](probes/issue-202/README.md)
are committed. Its live assertions remain untested. No real daemon lock was
touched. No full suite or build ran. Work stayed inside the 20-minute bound.

## Recommendation and open questions

**Inferred, 0.1.457/0.1.459 evidence.** Keep the two issues linked but distinct.
020-28/D17.5 explicitly promises an early report and bounded retention retry;
it does not promise immediate shell return. The decision is whether command
lifetime must end sooner and what retention guarantee then remains. Simply
exiting earlier risks worsening #201. This research chooses no implementation.
Existing holds stand.

Not determined: exact time from the original report to process exit; the
original daemon's lock operation and duration; original direct versus routed
writer path; installed-CLI timing under calm load. A future bounded probe can
close the wrapper timing gap. Diagnosing the original minute needs timestamped
stdout, stderr, process exit and lock-operation evidence from that run.

## Commands and sources

Read-only commands included `gh issue view 202 --repo hearsay-tools/squeal
--json title,body,comments,url,createdAt,updatedAt`, `git fetch origin main`,
`cat /proc/loadavg`, `getconf _NPROCESSORS_ONLN`, and:

```sh
git diff --exit-code squeal--v0.1.457 origin/main -- src/core/code/gate \
  src/cli/code-gate.ts src/cli/code-gate-stored.ts src/cli/code-gate-relaunch.ts \
  src/core/daemon/keep-request.ts src/core/daemon/lock.ts src/core/store/busy.ts
node docs/specifications/020-quality-gate/research/probes/issue-202/return-delay.mjs \
  /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.457/dist/cli/squeal.mjs \
  > docs/specifications/020-quality-gate/research/probes/issue-202/evidence-2026-11-12.txt
node docs/specifications/020-quality-gate/research/probes/issue-201/verify-evidence.mjs
node --check research/probes/issue-202/return-delay.mjs
```

The diff exited 0 with no differences. The new probe exited 0 with **SKIP**,
not PASS. The offline verifier and syntax check passed.
Local Markdown links and `git diff --cached --check` passed. Final affected
status used `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status
--wait 60000 docs/specifications/020-quality-gate/research/issue-202.md
docs/specifications/020-quality-gate/research/probes/issue-202/return-delay.mjs`: exit 3, no test closure covers
either path; zero known failures, 630 unknown of 1,736 test files. This is
not a passing affected-test verdict.

- [Reported incident #202](https://github.com/hearsay-tools/squeal/issues/202): reported 0.1.457, pass/0, other-worktree holder, about one extra minute. This is reported evidence, not independently observed host history.
- [Related incident #201](https://github.com/hearsay-tools/squeal/issues/201), [research](issue-201.md) and [probe method](probes/issue-201/README.md): retained measurements, failure caveat and source lineage.
- [020 spec](../spec.md) D11.7/D17.3/D17.5 and [status](../status.md); [021 spec](../../021-remote-store-and-execution/spec.md) D1/D5/D15; [011 spec](../../011-core/spec.md) C7. D17.5's last sentence describes daemon routing as later; 021-20's release record and current source establish that it shipped in 0.1.450.
- Source at [0.1.457](https://github.com/hearsay-tools/squeal/tree/49557fe0facdbe670664ed5e0146b662e346f169): `src/cli/code-gate{,-stored,-relaunch}.ts`, `src/core/code/gate/{keep,keep-write,keep-here,keep-sent}.ts`, `src/core/store/paths.ts`.

Coordinator note: the worker ran the new probe at repository-root `research/probes/issue-202/`. Integration moved its files into this spec’s `research/probes/issue-202/`; commands above show the final location. No live probe was rerun.
