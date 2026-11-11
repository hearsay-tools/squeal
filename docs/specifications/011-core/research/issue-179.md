# Issue 179: a named wait behind another worktree's claimed tier

Investigate named-wait latency within claimed tiers before changing claim expiry.

**Verdict:** partially reproduced on Squeal **0.1.430**, commit
`1ac649d408c9043997fd4eeb0c0ed3a079b1da4c`. Two real schedulers with separate
connections to one isolated SQLite store reproduced a promoted file waiting on
another worktree's claimed tier, then running after the owner closed without a
result. They did **not** reproduce an unbounded wait: a short configured bound
allowed takeover while the owner stayed live. Full daemon/CLI reproduction and
the cause of the reported incident remain **not determined**, because the issue
has no command output, timings, policy or incident version, and this bounded
probe used a synthetic runner and presence records.

## Scope and evidence

[Issue #179](https://github.com/hearsay-tools/squeal/issues/179), fetched with `gh`
on 2026-11-11, reports an 849-file sweep in hearsay-tools/cezarion and a worker
waiting until the coordinator stopped its daemon. The issue names 0.1.429 as the
current version, not the recorded incident version. The assigned parent also
reported runtime 0.1.429. This checkout and session runtime are 0.1.430.

The probe used Node **v24.22.1**, Linux, **24 CPUs**. One-minute load was **17.48**
at the initial check, **12.92** before the first probe, and **14.09** before both
scenarios of the final probe. All were below 24. No production daemon was
started, stopped, signalled or queried by the probe. No capacity pool was used.
All throwaway repositories, stores and run logs were under
`research/probes/issue-179/.scratch/` and were removed by cleanup. No hold was
changed. No product, board, spec, status or skill file was edited.

The brief has no numbered questions. These five questions make its requested
reproduction and limits explicit. Each experiment below ran source 0.1.430 at
the commit above; source findings refer to that same version.

| Question | Answer and evidence tag |
| --- | --- |
| 1. Does an 849-file owner queue claim every key? | **No.** The held first tier claimed 200 files; 649 stayed queued. The requester ran a queued-only file. **verified by experiment**, 0.1.430. |
| 2. Does named promotion bypass a live claim? | **No in this setup.** The same-key promoted file stayed queued with zero local runs while the owner held its tier. **verified by experiment**, 0.1.430. |
| 3. Does ending the owner without a result release the wait? | **Yes at the scheduler boundary.** The requester ran the file once and stored a current pass, 128 ms after the owner close began. **verified by experiment**, 0.1.430. |
| 4. Is there already a bounded takeover? | **Yes.** With requester `timeoutMs: 1000`, takeover started after 7,535 ms while the owner was still active. Default policy gives 606,000 ms; null timeout gives 600,000 ms. **verified by experiment**, 0.1.430. |
| 5. Does status identify the owner and its queue position? | The named-file status reader returned the owner's worktree and a time bound. Its claim standing has no owner queue position. **verified by experiment** for the returned standing; **read in source code** for its construction, 0.1.430. CLI rendering was not exercised. |

## Findings

### 1. The claim belongs to a tier

**verified by experiment — 0.1.430.** The probe created a repository of 849 small
files and a linked worktree with identical content. The owner held its first
200-file tier. The requester computed equal keys, then promoted one claimed
file (`test/f00.test.ts`) and one file only queued in the owner
(`test/f200.test.ts`). At the observation after 2,230 ms, the requester had run
the unclaimed file once and the claimed file zero times.

**read in source code — 0.1.430.** `startTier` marks every selected file running
before calling the runner. `testFileKeys.claimed` requires
`pending = 'running'` and a fresh owner heartbeat. It does not claim all queued
files. C4 and C7 specify the same boundary. C15 explicitly keeps a promoted
file subject to another worktree's claim.

**inferred — 0.1.430.** A file admitted to a large runner tier can be claimed
before the runner actually starts that file. This is a plausible explanation
for the reported "queue sweep", distinct from a file still queued in Squeal's
scheduler. The probe holds a whole synthetic tier and does not observe real
Vitest worker admission, so it does not prove that explanation for #179.

### 2. A claim already has an expiry rule

**verified by experiment — 0.1.430.** Ending only the synthetic owner's held run
without results and closing its scheduler let the requester produce a current
pass in 128 ms. A separate one-file scenario left the owner active. With the
requester's timeout set to 1,000 ms, the requester began its own run at 7,535 ms
and stored one pass. A direct clock probe against `Claims` held at exactly
7,000 ms and released at 7,001 ms. This clock probe did not wait in real time.

**read in source code — 0.1.430.** C7 and `claims.ts` set the limit to the
requester's timeout plus 6 seconds, or 600 seconds for a null timeout. It starts
at this scheduler's first sight of the claim. `holds` releases when elapsed time
is **greater than** the bound. The claim pump rechecks at least every 1 second
when it can run; it polls store changes every 250 ms. These are claim eligibility
rules, not a hard end-to-end verdict deadline under a stalled process or a busy
runner. The default timeout is 600 seconds, yielding a 606-second claim bound.

### 3. The existing diagnostic names the worktree

**verified by experiment — 0.1.430.** `readNamedFiles` returned a `claim` reason,
the isolated owner's absolute root, and `until - readAt = 606000` milliseconds.

**read in source code — 0.1.430.** `standing.ts` computes `until` as the reader's
current time plus the policy's claim bound. This is a conservative upper bound,
not the scheduler's remaining countdown. C15 documents why: the scheduler keeps
its first-seen time in memory. The reason carries no runner queue position.
The status amendment of 2026-11-05 preserves the open-run claim wording; the
2026-10-31 named-wait ordering amendment preserves the claim rule. C6 governs
the status snapshot; C4 governs tier admission; C7 governs claim expiry; C15
governs promotion and this reason. None authorizes overriding a hold here.

## Recommendation and limits

**inferred — 0.1.430.** Treat #179 as evidence of latency under an existing
claim policy, not yet proof of missing expiry or claims over the entire queue.
A shorter wait trades fewer duplicate runs for faster local evidence. Gather
an incident's actual claimant phase, tier size, runner progress, requester
policy and first-seen elapsed time before selecting that tradeoff. This report
proposes no implementation or change to approved rules.

Open questions: Was the reported file in a running tier or only queued? Was the
wait longer than 606 seconds, or was a different timeout configured? Did the
requester's scheduler keep making progress? Did the CLI omit the existing claim
reason? Does a real Vitest tier reproduce the same delay with a target admitted
but not started? Those points are not determined by these probes.

The final probe completed in 10.323 seconds. This is not an 849-test Vitest
benchmark: its test files are comments and its fake runner returns synthetic
passes. It does not exercise sockets, hooks, real daemon startup/shutdown,
watcher fast-forward handling, host capacity, or the CLI wait loop. The earlier
run also passed the shared-tier and close cases (100 ms recovery); the committed
log is the final run. No full suite was run. The affected status check returned no verdict for these
research paths (exit 3); the worktree had zero known failures and 683 unknown
test files. See the probe README for validation limits.

## Commands and sources

From the repository root:

```sh
gh issue view 179 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt
cat /proc/loadavg
nproc
git rev-parse HEAD
git rev-parse 'squeal--v0.1.429^{commit}'
git diff squeal--v0.1.429 HEAD -- src/core/scheduler/claims.ts src/core/scheduler/tiers.ts src/core/store/repos/test-files.ts src/core/status/standing.ts
pnpm exec tsx docs/specifications/011-core/research/probes/issue-179/probe.ts > docs/specifications/011-core/research/probes/issue-179/output.jsonl 2> docs/specifications/011-core/research/probes/issue-179/stderr.txt
```

The diff was empty for those four mechanism files against 0.1.429 release commit
`95c8a3e6e7f3f799dee0ea4ff0a606505ce22d80`. This establishes unchanged source
there, not a run of the older runtime.

- [Probe, isolation and commands](probes/issue-179/README.md),
  [recorded output](probes/issue-179/output.jsonl), [script](probes/issue-179/probe.ts).
- [Spec C4, C6, C7, C15](../spec.md), [amendment log](../status.md).
- Source at the examined commit:
  [claims.ts](https://github.com/hearsay-tools/squeal/blob/1ac649d408c9043997fd4eeb0c0ed3a079b1da4c/src/core/scheduler/claims.ts),
  [tiers.ts](https://github.com/hearsay-tools/squeal/blob/1ac649d408c9043997fd4eeb0c0ed3a079b1da4c/src/core/scheduler/tiers.ts),
  [test-files.ts](https://github.com/hearsay-tools/squeal/blob/1ac649d408c9043997fd4eeb0c0ed3a079b1da4c/src/core/store/repos/test-files.ts),
  [standing.ts](https://github.com/hearsay-tools/squeal/blob/1ac649d408c9043997fd4eeb0c0ed3a079b1da4c/src/core/status/standing.ts),
  [policy.ts](https://github.com/hearsay-tools/squeal/blob/1ac649d408c9043997fd4eeb0c0ed3a079b1da4c/src/core/types/policy.ts).
