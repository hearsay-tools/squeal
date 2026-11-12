# Issue 201: completed gate results still expire under store contention

Keep #201 as post-release evidence of bounded result loss; link #202 for the separate return-delay concern.

**Verdict: loss reproduced on the current source gate, but the exact two-daemon
handover is not reproduced.** The gate passes and prints its report, waits,
then discards completed results when its 30 s keep bound expires. This matches
020 D17.5's explicit exhaustion rule. Neither released row promises durable
retention beyond that bound. Preserving expensive completed runs versus bounding
command lifetime is the unresolved tradeoff; this report proposes no design.

Examined 2026-11-12 at `d3d40f583e22c2149469d6751ed6837a63072575`
(`origin/main`, package 0.1.459). Release 0.1.457 is
`49557fe0facdbe670664ed5e0146b662e346f169`. The gate directory,
`keep-request.ts`, `daemon/lock.ts` and `store/busy.ts` have no diff between
them. Experiments ran current source, not the installed 0.1.457 executable.

## Questions and evidence

| # | Question | Answer | Tag and version |
|---|---|---|---|
| 1 | Can the gate lose completed results under a busy shared store? | Yes. Five passed files were not kept after 30 s; the next run reran all five. | verified by experiment, source 0.1.459 |
| 2 | Do an unlocked store and a short hold recover? | Yes. Both second runs read all five files from the store. | verified by experiment, source 0.1.459 |
| 3 | Does routing through the serving daemon remove loss? | No. Real socket handlers and `keepInDaemon` dropped two synthetic completed files at a 600 ms bound; the gate opened zero store write transactions. | verified by experiment, source 0.1.459 |
| 4 | Does another daemon then this worktree's daemon take the store? | Not determined: neither full daemon lifecycle nor that handover was exercised. The issue records two holder snapshots; those do not prove a singleton-lock theft or a continuous hold. | inferred, reported 0.1.457 and source 0.1.459 |
| 5 | Are completed rows 020-28 and 021-20 sufficient? | They implement earlier reporting, bounded retry and daemon routing. Both retain expiry and loss. 020-28 shipped 0.1.447; 021-20 part two shipped 0.1.450. | read in source code and repository specifications, current HEAD |
| 6 | Is this a duplicate of #192 or #202? | Same loss class as #192, now reported after its fix. #202 concerns waiting for command return after JSON, which can happen even if all writes later succeed. Link them; do not claim either release eliminates #201. | inferred, current HEAD and reported 0.1.457 |
| 7 | Why 449 lost files, or the earlier exit 3? | Not determined: no original stores, per-file keep decisions or earlier report are available. | inferred, reported 0.1.457 |

## What ran

Host: 24 online CPUs, Node v26.13.0, pnpm 12.15.0, Vitest 5.0.3.
One-minute loads: 10.09 at the initial check, 14.25 before preparation,
15.79 immediately before the run. All were below 24. Afterward load was
25.36, so no further live probes ran. Total investigation stayed below
20 minutes. No full suite or shared live daemon intervention occurred.

The CLI probe adapts [issue 192's fixture](issue-192.md). Each case creates
an isolated temporary git repository with five node:test files, its own
stores, and the kit's temporary HOME/TMPDIR. A separate Node process holds
`BEGIN IMMEDIATE` on that scratch `store.sqlite`. The CLI runs in process
through `codeCommand` with `--base main --json`; no JSON child relaunch runs.
The served probe uses the existing daemon kit, real socket handlers and
`keepInDaemon`, with synthetic results and keys, not a full daemon or runner.

| Case | Report at | Return at | First verdict / exit | Next-run reuse |
|---|---:|---:|---|---|
| No lock | 980 ms | 1,042 ms | pass / 0 | 5 of 5 |
| Held throughout | 978 ms | 31,613 ms | pass / 0 | 0 of 5 |
| Freed at 3,375 ms | 927 ms | 3,665 ms | pass / 0 | 5 of 5 |

**Verified by experiment, source 0.1.459.** The held case says
`5 completed test files were not kept in the stores: the store stayed busy
for 30 s`, names the child holder, and says they will run again. The next
run has no `from` map and runs five files with no stored duration. The
serving-handler case returns after 1,206 ms at its shortened 600 ms bound,
records one coverage and three results requests, and leaves both result
keys empty after release. No later durable retry was tested.

The explicit probe command exited **1**: two checks passed and two failed.
Both failures were research assertion errors: `from` is a map, not an
array, so `toHaveLength(5)` rejected the correctly logged reuse maps.
The committed assertions use `Object.values`. They were **not rerun live**
because load exceeded the CPU count. The offline `verify-evidence.mjs`
passed against the saved output, including the corrected map assertions,
all six gate verdicts, loss, delay and daemon-routing checks. This is not
a claim that the corrected live probe suite passed. Final Squeal status for the
research report and the two `.probe.ts` files returned exit 3: no test closure
holds these paths. It reported zero known failures and 631 unknown test files;
that is not a passing affected-test verdict. `git diff --cached --check` passed.

## What the source proves

**Read in source code, identical examined paths in 0.1.457 and 0.1.459.**
`Keeper.#write` chooses its writer once. If it acquires the per-worktree
singleton lock, it keeps that lock through the direct write and releases
it in `finally`. If the lock is held and the heartbeat is fresh,
`sentWriter` uses daemon requests. Both paths use the same `StoreWait`,
whose bound is `KEEP_BUSY_BOUND_MS = 30_000`. The bound tracks elapsed time
from the first busy refusal; a different holder does not reset it.
`flush` removes the in-memory queue at entry; exhaustion returns without
persisting the remaining queue. `keepInDaemon` returns `kept: false` for
a busy slice; the keeper owns retries and the bound.

**Inferred, 0.1.457/0.1.459.** Shared SQLite write-lock ownership and the
per-worktree singleton lock are different facts. A holder named at expiry
cannot alone show that a new own daemon stole the singleton during a
direct flush. The same busy messages exist on the routed path. The two
reported holder names do not identify which path ran, what operation held
the lock, or why it lasted. The exact reported chain remains open.

**Read in source code, current HEAD.** `code-gate.ts:154` awaits all
`afterReport` work in `finally`; `code-gate-stored.ts:102` awaits `flush`.
Printing the verdict first satisfies 020-28, but does not release a shell
waiting for process exit. This explains #202's category; its reported
approximately one minute was not reproduced (the measured delay was
30,635 ms). The short-lock case proves delay need not imply lost results.

## Commands and sources

Read-only evidence commands:

```sh
uptime
getconf _NPROCESSORS_ONLN
node --version
pnpm --version
gh issue view 201 --repo hearsay-tools/squeal --json title,body,comments
gh issue view 202 --repo hearsay-tools/squeal --json title,body
git rev-parse HEAD origin/main
git rev-parse squeal--v0.1.457^{commit}
git diff --stat squeal--v0.1.457 HEAD -- src/core/code/gate \
  src/core/daemon/keep-request.ts src/core/daemon/lock.ts src/core/store/busy.ts
```

The long-job launcher below ran the probe (exit 1, 47.34 s):

```sh
/home/agent/.nvm/versions/node/v26.13.0/bin/node \
  /home/agent/.nvm/versions/node/v26.13.0/lib/node_modules/@hearsay-tools/squawk/dist/index.js \
  job start issue-201-probes -- env ISSUE201_OUT=/tmp/issue-201-e8063559-evidence.txt \
  pnpm exec vitest run \
  --config docs/specifications/020-quality-gate/research/probes/issue-201/vitest.config.ts
node docs/specifications/020-quality-gate/research/probes/issue-201/verify-evidence.mjs
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  docs/specifications/020-quality-gate/research/issue-201.md \
  docs/specifications/020-quality-gate/research/probes/issue-201/gate-lock.probe.ts \
  docs/specifications/020-quality-gate/research/probes/issue-201/served.probe.ts
```

- Reports: [#201](https://github.com/hearsay-tools/squeal/issues/201), [#202](https://github.com/hearsay-tools/squeal/issues/202), prior [#192](https://github.com/hearsay-tools/squeal/issues/192). Issue statements are reported evidence, not independently verified host history.
- Contracts: [020 spec](../spec.md) D11.7, D17.3, D17.5 and [status](../status.md); [021 spec](../../021-remote-store-and-execution/spec.md) D1, D5, D15 and [status](../../021-remote-store-and-execution/status.md); `docs/board.md` rows 020-28 and 021-20. D17.5's last sentence still says 021-20 is later; the release log and source establish that it shipped.
- Source at examined HEAD: `src/core/code/gate/{keep,keep-write,keep-sent,keep-here}.ts`, `src/core/daemon/{keep-request,lock}.ts`, `src/core/store/busy.ts`, `src/cli/{code-gate,code-gate-stored}.ts`.
- [Probe files and method](probes/issue-201/README.md), [raw evidence](probes/issue-201/evidence-2026-11-12.txt), [original failed-run log](probes/issue-201/run-2026-11-12.txt).

Open: capture the original daemon path and lock operation; explain its duration
and the 449-file subset; decide whether to retain results beyond the bound and
whether command return must stop waiting. No product change or hold is authorized
by this research. Existing holds stand.
