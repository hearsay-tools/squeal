# Issue 77: handover blocks validation and status waits

Date: 2026-10-22. Documentation-only triage against origin/main `7f02076292d852ab1cd06df61e204d4bda898aef`.

## Fit and owner

Inferred: passes the vision decision filter. Stable validation and quiet waits improve trustworthy feedback, reduce blocking and preserve uncertainty. Spec 011 owns C5 (delivery), C6 (status), C7 (store), C8 (Stop) and C9 (handover). Related: spec 002 D3–D5 for Codex Stop and shared delivery. No spec, status amendment, skill or product change is authorized. Existing holds stand.

## Reproduction verdict

Not reproduced, because the one-minute host load reached 24.51 above 24 online CPUs before dispatch. No researcher, live probe, test run or affected-session inspection started. The earlier intake sample was 22.17; it was not used to authorize a later probe. No probe directory was needed.

Reported runtime: Squeal 0.1.262 handing over to 0.1.264; retained session skill 0.1.264. Checkout package: 0.1.266; this triage session's Squeal skill: 0.1.265. These are distinct observations, not proof of the affected daemon's installed assets.

Exact read-only intake commands:

```sh
git fetch origin
git show origin/main:docs/board.md
gh issue view 77 --repo hearsay-tools/squeal --json state,title,body,comments,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue view 75 --repo hearsay-tools/squeal --json title,body
gh issue view 1 --repo hearsay-tools/squeal --json title,body
```

Load outputs: `22.17 19.57 21.18` at intake and `24.51 20.16 21.36` before reproduction; CPU command returned `24`. No reproduction command ran. The issue reports `squeal status --wait 60000 packages/web/e2e/session-footer.e2e.ts`, with store-busy returns after 339 ms and 223 ms, and `squeal start`, with no successor answering after 90 s. These are reporter evidence, not commands executed here.

## Evidence and duplicates

Read in GitHub issue 77 and its 14:04 UTC comment: the reporter observed repeated handover/recovery notices around 13:46–14:03 UTC, changing handover timestamps, selected status without a current verdict, and 200 pending / 1,916 stale checks. Direct tests passed under the permitted fallback. Stop reports also woke Cezar waits with unchanged pending/handover status, zero current known failures, optional slow tests pending and no required checkpoint. The relationship among these symptoms is unverified.

Read in origin/main board and open issues, including those labelled `triaged`: no #77 row exists. Open #75 / gh-75 is a partial duplicate for alternating notices; its isolated 0.1.260 to 0.1.261 probes did not reproduce them and did not exercise a real tier or shared-store contention. Keep one gh-77 row for the additional blocked-validation, status-wait and Stop-wake evidence; do not assume one root cause. Open #1 overlaps store contention and daemon loss, but not version handover. Open #76 concerns new-file discovery, not this symptom. The named `session-footer.e2e.ts` has no board row.

Read in board and 011 status amendments: done 011-110 shipped the successor-claim repair in 0.1.264. Done 011-113 shipped a status-store retry/read repair in 0.1.266, after this report's runtime. Its finding says a status read upgraded a transaction to write through attribution. This is a plausible overlap with the early BUSY returns, not proof that 0.1.266 resolves #77. Closed #47 and #72 cover earlier handover and runtime-retention work. No exact duplicate covers all reported outcomes.

## Human decision

Decide whether to join the notice evidence to gh-75 and approve a bounded follow-up on current released Squeal for the remaining handover, status-wait and Stop-wake symptoms. First distinguish completed successor ownership from a heartbeat recovery, and check whether 0.1.266's 011-113 resolves the early BUSY return. No implementation is dispatched by this row.

Done when an upgrade converges to one validating daemon; selected waits tolerate brief contention within their bound and return a current verdict or stable actionable state; unchanged optional pending/handover state does not repeatedly wake a parked task. Regression evidence must cover concurrent old/new hooks, active queued checks, a busy shared store and Stop delivery without weakening failure or checkpoint policy.
