# Issue 214: pending retries and stored gate failures

Recommend treating #214 as confirmed stored-failure reuse and retry diagnostics, while preserving the held retry-priority policy. The original 40-minute stall is not reproduced.

## Scope and versions

Examined Squeal **0.1.477**, commit `b12273f596f01c4d82535860dbafcd9bc43b6476`, Node **v26.13.0**, pnpm **12.15.0**. Research started 2026-11-14 at 02:04 Europe/Warsaw (01:04 UTC). Initial load was **1.50 / 24 CPUs**; the successful probe sampled **0.62, 0.49, 0.75** (1/5/15 minutes), 24 available CPUs. Live probes were permitted. No host load was generated, no full suite ran, and no product, spec, status, skill or board file changed.

The issue reports **0.1.467**, about 20 Squawk worktrees, load 115–170 / 24 CPUs, and no retained JSON status or Squeal revision. Those are reporter claims, not measurements from this research. Installed session Squeal is **0.1.475**; the probe imports **0.1.477 checkout source**, not that installed bundle.

## Questions and verdicts

| Question | Answer and evidence tag |
| --- | --- |
| 1. Can the original load/environment retry stall be reproduced? | **Not determined, because** the incident has no JSON snapshot, queue/claim history or daemon notes. No 20-worktree overload, 40-minute wait or restart sequence was replayed. |
| 2. Does 600 s promise a start, and can an environment retry still wait? | **Verified by experiment, 0.1.477:** 600 s from the first closed-gate look makes the load retry queued, not started. An environment retry queues immediately without that gate. Normal edit work can precede either. |
| 3. Does the gate reuse a failed result while an explicit retry is pending? | **Verified by experiment, 0.1.477:** yes, for a pending load request and after an environment request joins it. Exit 3, `incomplete`, `test-failed`, `from: store`; no replacement result or retry completion. |
| 4. Does retry support or explain waiting? | **Verified by experiment, 0.1.477:** `retry --wait 1` exits 2. **Read in source code, 0.1.477:** failed-result retry receipts and usage omit the exact `status --wait` command; no-result receipts already include it. |
| 5. Do existing issues or #210 cover this? | **Read in official docs, board at b12273f:** #127 holds retry priority; #139 covers missing blocker evidence; #200 covers stored-failure recovery. #210 shipped in 0.1.475 but excludes stored evidence from its in-gate retry. |

## Findings

**F1. Eligibility is distinct from start. [verified by experiment; 0.1.477]** The probe creates a retry at synthetic time 1,000 ms, advances 600,000 ms before the first daemon look, and observes no queue insertion. That look writes `gateClosedAt = 601000`. At gate age 599,999 ms it is still held; at exactly 600,000 ms it is claimed and queued. Its request age is now 1,200,000 ms. Adding an edit to the real `RunQueue` gives `[test/edit.test.ts, test/retry.test.ts]`. An environment request at another key queues without a gate timestamp. Neither case starts a runner in this controlled seam.

**F2. The receipt can be read as a stronger promise. [read in source code; 0.1.467 and 0.1.477]** `loadRetryWhenText` says “runs once more ... after at most 10 min above it”. `queueDue` actually calls `ledger.enqueue(..., priorityOf(...), true)` after the bound; it grants no start deadline. Spec 011 C5 explicitly says “forced at the file's normal priority”. `dueOf` also excludes a blocked file, a different key, and an already-queued retry; claims held elsewhere are another admission constraint. The existing 011-213 status amendment records that a slow retry may then meet its lane's separate load guard. Thus an overdue receipt alone does not prove the load timer failed. Raising priority would change the policy held under #127.

**F3. “Unknown” does not establish an empty scheduler. [verified by experiment; 0.1.477]** `retryWaitOf` given no recorded open runs or lane activity returns `{kind:"unknown"}` and “it has not started; what holds it is not known”, while the controlled queue contains an edit ahead of the retry. This reader has no fast-lane queue or capacity dependency input. The experiment establishes a diagnostic limit, not which dependency held the original run. Spec 011 C6 requires uncertainty to remain visible; C9's restart behavior does not itself prove that a replacement daemon reached retry intake.

**F4. Pending retries do not alter gate reuse. [verified by experiment; 0.1.477]** An isolated repository has one changed function, `double`, and one node:test assertion that deliberately fails. The first real gate handler runs and stores it (exit 3, recorded duration 183 ms). The probe asks a load retry at the same computed key. The next gate reports:

```json
{"code":3,"verdict":"incomplete","from":{"test/math.test.ts":"store"},"durationMs":null,"function":{"name":"double","state":"incomplete","gap":"test-failed"}}
```

Stderr says “none to run, 1 read from the stores”. Stored results remain identical and the request remains pending. A third gate, with an environment request also pending, gives the same exit, verdict and origin. The last two gate calls receive synthetic load 170 / 24 CPUs; neither runs the stored file again. The fixture has no daemon, deliberately keeping requests pending. This reproduces the gate's decision, not daemon starvation or an external-load failure.

**F5. This follows the current store contract. [read in source code; 0.1.467 and 0.1.477]** `gate/stored.ts:evidenceAt` reads results plus coverage at the current key; it does not read retry records. Spec 020 D11.7 requires keyed reuse, and D7 records its origin. Spec 011 C4 defines validity by key; C5/C6 keep a same-key failure counted until a passing result replaces it. A pending request is not evidence that the failure was false. The inspected `gate.ts`, retry `waits.ts`/`text.ts` and gate `stored.ts` have no diff between the 0.1.467 tag and this checkout. The original release was inspected, not executed.

**F6. #210 does not resolve stored evidence. [read in source code; 0.1.475 policy as present in 0.1.477]** `gate/retry.ts` states “Evidence from the stores or the parts never reruns”. Row 020-54 and its status amendment restrict the retry to files that fail in this gate run. A different policy for a pending explicit retry needs its own decision; it cannot be described as already shipped by #210.

**F7. Wait guidance is incomplete specifically for known failures. [read in source code; 0.1.477]** `retry.ts:USAGE`, `main.ts` help and the known-failure receipt do not name `squeal status --wait 60000 <file>`. The receipt only says status lists pending retries. `waitText` already gives the exact command for a no-result file. For a failed file's explicit retry, named status reports “retry: normal priority; waits for named groups and edits' work” (`named-step.ts`). Recommend documenting the supported wait without implying that it grants retry priority or guarantees completion by its deadline. Live wait completion was not tested.

## Recommendation and open questions

**[inferred; 0.1.477]** Attach this evidence to #200 for stored-failure recovery and to #127/#139 for eligibility, queue latency and missing dependencies. Keep #214's pending-request case explicit: it was absent from the earlier #200 reproduction, which was skipped for load. Prioritize accurate eligibility/start wording and wait guidance. Preserve failed evidence until a valid replacement exists. Existing holds stand; this report authorizes no build or change of priority.

Not determined: the original daemon's blocker, whether restart took over the same key, whether another live worktree held the claim, whether its lane/pool was blocked, and whether any live retry violated existing fairness. An incident snapshot needs daemon identity/liveness, revision and keys, retry claim and gate time, open runs, lane activity and notes. The probe does not measure 20-worktree fairness, delayed reconciliation, busy-store behavior or original Vitest failure causality.

## Commands, results and sources

- `gh issue view 214 --repo hearsay-tools/squeal --json title,body,comments,state,url`: OPEN, no comments. Also fetched #127, #139, #200 and #210 with `--json number,title,state,body`; first three OPEN, #210 CLOSED. Sources: [#214](https://github.com/hearsay-tools/squeal/issues/214), [#127](https://github.com/hearsay-tools/squeal/issues/127), [#139](https://github.com/hearsay-tools/squeal/issues/139), [#200](https://github.com/hearsay-tools/squeal/issues/200), [#210](https://github.com/hearsay-tools/squeal/issues/210).
- `node -p 'JSON.stringify({version:require("./package.json").version,node:process.version,cpus:require("node:os").cpus().length,available:require("node:os").availableParallelism(),load:require("node:os").loadavg(),time:new Date().toISOString()})'`: 0.1.477, v26.13.0, 24/24, `[1.5,0.63,0.93]`, `2026-11-14T01:04:35.298Z`.
- `pnpm exec tsx docs/specifications/011-core/research/probes/issue-214/probe.ts > docs/specifications/011-core/research/probes/issue-214/output.txt 2>&1`: **exit 0**, all assertions passed. First attempt reached and proved stored reuse but exited 1 because the probe expected an unquoted `--wait` error; corrected that assertion, then reran. This was a probe error, not a product failure. [Probe and limits](probes/issue-214/README.md), [source](probes/issue-214/probe.ts), [raw output](probes/issue-214/output.txt).
- `git rev-parse 'squeal--v0.1.467^{commit}' 'squeal--v0.1.475^{commit}'`: `c601627a6739796b9aeb54030886a720d025d181`, `95350e5e916f45540b251545a34351bfb2f4c6d1`. `git diff squeal--v0.1.467 HEAD -- src/core/retry/gate.ts src/core/retry/waits.ts src/core/retry/text.ts src/core/code/gate/stored.ts`: empty. Read the older scheduler with `git show squeal--v0.1.467:src/core/scheduler/retries.ts` too.
- Repository contracts: [011 C4/C5/C6/C9/C15](../spec.md), [011 amendments](../status.md), [020 D7/D11](../../020-quality-gate/spec.md), [020 amendments](../../020-quality-gate/status.md), [board holds](../../../board.md). Source root at the examined commit: [GitHub tree](https://github.com/hearsay-tools/squeal/tree/b12273f596f01c4d82535860dbafcd9bc43b6476/src); paths above name the exact modules and functions.

Verification after formatting: `pnpm exec biome check --write docs/specifications/011-core/research/probes/issue-214/probe.ts` exited 0 (formatted one file); the probe rerun exited 0. `git diff --check` exited 0. `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/probes/issue-214/probe.ts docs/specifications/011-core/research/issue-214.md` exited 3: neither path is in a test closure; known failures 0, 963 of 1,788 test files unknown. The independent throwaway probe is the verification here; no repository-suite pass is claimed. No product build or repository typecheck was needed for this research-only change.

Coordinator integration: moved probes under the owning spec as the triage brief requires and adjusted relative source imports. The commands above name the final paths; worker execution used `research/probes/issue-214/` before the move. No product source changed.
