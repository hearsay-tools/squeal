# Issue 110: named slow files behind fast backlog

Recommend treating #110 as evidence for #78's remaining named slow-file demand, with a human decision on changing lane eligibility.

**Verdict:** reproduced on Squeal **0.1.365**, commit
`faa43f8823fd7a047c3491e9d39d61024632bd5a`, on 2026-10-27. A named slow-file
wait stayed pending after the current fast tier ended and another fast
backlog tier started. Promotion worked within the slow lane once fast work
drained. This matches 004 D2; it does not establish a broken fast promotion.

## Questions and evidence plan

| Question | Method and version | Answer and tag |
| --- | --- | --- |
| 1. Does a named slow wait remain behind unrelated queued fast work after the current tier? | Isolated real CLI/daemon probe, 0.1.365; three gated fast files and two slow files | Yes. The next fast tier started while the named slow file stayed pending. **verified by experiment** |
| 2. Is promotion lost, or does lane eligibility still bind? | Same probe; read scheduler at `faa43f882` and 004 D2 / 011 C15 | Named `slow-z` ran before `slow-a` after the fast drain. `#fastFirst()` checks the fast backlog before selecting slow candidates. **verified by experiment** for order; **read in source code** for the gate |
| 3. How does this overlap #79 and #78? | Fetch all three GitHub issues and comments; read board and 004 amendment log at `faa43f882` | #79 concerns fast-file promotion. #78 still asks for one named slow run with a stored result; its lease-release part shipped in 0.1.325. Treat #110 as overlapping that remaining demand. **inferred**, from the fetched issue records and shipped-history docs |

## 1. Live reproduction

**verified by experiment — Squeal 0.1.365, Node v24.21.0, Linux.** Initial
load check at 02:35:31 UTC was 14.18 on 24 CPUs. The probe checked again at
02:37:21 UTC: load averages **15.16 / 13.88 / 14.55**, CPU count **24**,
available parallelism **24**. One-minute load was below the skip threshold.
At completion it was 15.08. The throwaway CLI probe exited **0**; all its
ordering and verdict assertions passed.

The fixture is a new Git repository and private runtime/store. It has three
independent fast files and two independent slow files. Fast files wait on
external release gates; slow files return immediately. There is no source
edit, browser setup, shared claim or dependency between these test files.
Policy sets `baseline.onStart: "lookup-then-run-missing"`, both fast tier
sizes to 1, and `slow: { trigger: "continuous", quietMs: 0, maxParallel: 1 }`.
Only the five fixture files run.

Exact reproduction command, from this checkout root:

```sh
node docs/specifications/004-slow-suites/research/probes/issue-110/probe.mjs > docs/specifications/004-slow-suites/research/probes/issue-110/result.jsonl 2>&1
```

The script's child argv arrays, temporary cwd and environment overrides are
in [result.jsonl](probes/issue-110/result.jsonl). The key commands are
`node <checkout>/plugins/claude-code/dist/cli/squeal.mjs` followed by:

```text
daemon <fixture>
status --json slow-z.test.mjs
status --json --wait 4000 slow-z.test.mjs
status --json --wait 20000 slow-z.test.mjs
stop <fixture>
```

| Event, UTC | Observed result |
| --- | --- |
| 02:37:22.483 | `fast-a` starts; `fast-b`, `fast-c` and both slow files are queued. |
| 02:37:24.392 | Named wait is open; slow activity is `{ "kind": "waiting", "for": "fast" }`. |
| 02:37:24.408 / 24.600 | `fast-a` ends; `fast-b` starts. Neither slow file starts. |
| 02:37:25.064 | Snapshot after that boundary still shows two pending slow files, waiting for fast. |
| First wait ends | Exit **3**, `outcome: "timeout"`, `waitedMs: 4016`, selected result `none`, reason `pending`. |
| 02:37:28.134 / 28.323 | Remaining fast gates are released; `fast-b`, then `fast-c`, finish. |
| 02:37:28.557 / 28.797 | Named `slow-z` runs before unnamed `slow-a`. |
| Second wait ends | Exit **0**, `outcome: "settled"`, `waitedMs: 2294`, selected result `pass`, revision 0. |

The pending selected-file reason was: `slow, run after the fast tests or on
<launcher> run --slow`. No fast count or wait estimate appeared in that
reason. The probe stopped its daemon successfully and removed its fixture.

## 2. Why the next fast tier still wins

**read in source code — 0.1.365, `faa43f882`.**
[`slow-tier.ts`](../../../../src/core/scheduler/slow-tier.ts), `#fastFirst()`:

```ts
return this.host.editPending() || (!this.#requested && !this.host.fastIdle());
```

`#candidates()` calls this before selecting slow files and publishes
`waiting/fast` when it holds. In
[`scheduler.ts`](../../../../src/core/scheduler/scheduler.ts), `#fastIdle()`
returns false while fast work is queued or running. `promote()` changes
queue priority and pumps scheduling; it does not call `requestSlowSuite()`.
The probe's observed order and status match these branches.

**read in official docs — repository contracts at `faa43f882`.** 004 D2 says
background fast work “holds it back too ... unless `squeal run --slow`
asked.” 011 C15 says a promoted slow file “leads its own tier's order when
the tier runs.” C15's in-turn wording still describes the older idle rule;
004 D2/D7 and the 2026-10-19 amendment establish the continuous default used
here. Neither contract grants a named slow wait a fast-backlog bypass.

The explicit `run --slow` exception is lane-wide. It still waits for an
edit's fast work, as the source above shows. This research did not run it,
so it makes no measured claim about that command's timing.

## 3. Overlap and recommendation

**inferred — fetched issue records on 2026-10-27, checkout 0.1.365.**
[#110](https://github.com/hearsay-tools/squeal/issues/110) reports this
friction on **0.1.359**: six bounded waits across about 28 minutes; its later
comment supplies another two-wait case. Those are reporter observations,
not timings reproduced here. This probe confirms the scheduling mechanism
on 0.1.365.

[#79](https://github.com/hearsay-tools/squeal/issues/79) asks for named fast
files to move ahead of their own queue. Its 2026-10-25 decision keeps it
proposed and assigns tier-size research to 011-208. This probe shows a slow
lane eligibility limit, so it is not evidence that #79's fast promotion
contract failed.

[#78](https://github.com/hearsay-tools/squeal/issues/78) has two parts. Its
lease-release work shipped as 011-211 in 0.1.325. Its 2026-10-26 comment asks
whether `squeal hold -- npm run test:e2e -- <file>` is enough, or whether a
daemon-owned named run with a stored result is still needed. #110 supplies
further evidence for that second demand; it does not reproduce a lease bug.

**Recommendation, inferred:** retain this evidence with #78's remaining
named slow-file scope. The deciding tradeoff is prompt evidence for selected
slow files versus 004 D2's protection of pending fast work from slow-run
contention. Changing that priority needs a human-approved contract change.
No implementation or dispatch follows from this report.

## Limits and sources

Not determined: exact delay in cezarion, browser setup cost, contention with
real fast tests, effects of a shared-contract edit, and whether the hold
workflow meets the reporter's needs. This small node:test baseline probe
does not reproduce the 611-file workload, CI overlap or original 0.1.359
binary. No repository test suite, lint, typecheck or build was run; product
code was unchanged.

- [Probe and method](probes/issue-110/README.md), [script](probes/issue-110/probe.mjs), [retained output](probes/issue-110/result.jsonl).
- [004 spec](../spec.md), D2/D3/D7/D8; [004 status](../status.md), 2026-10-14, 2026-10-19 and 2026-10-25 amendments; [011 C15](../../011-core/spec.md#c15-named-demand), all at `faa43f882`.
- Source at the examined commit: [slow eligibility](https://github.com/hearsay-tools/squeal/blob/faa43f8823fd7a047c3491e9d39d61024632bd5a/src/core/scheduler/slow-tier.ts#L271), [promotion](https://github.com/hearsay-tools/squeal/blob/faa43f8823fd7a047c3491e9d39d61024632bd5a/src/core/scheduler/scheduler.ts#L651), [fast idle](https://github.com/hearsay-tools/squeal/blob/faa43f8823fd7a047c3491e9d39d61024632bd5a/src/core/scheduler/scheduler.ts#L1264).
- Issue sources: `gh issue view 110 --repo hearsay-tools/squeal --json number,title,body,comments,state,url`, repeated for `79` and `78`; URLs linked above. Read-only; no issue comments posted.
