# Issue 128: validation stops during an active Codex session

Date: 2026-10-29. Issue: https://github.com/hearsay-tools/squeal/issues/128.

## Fit and owner

Inferred: passes the vision decision filter. Explain observed validation state and recovery without duplicate runs or false confidence. Owner: 011 core C6 (status), C8 (hook delivery), C9 (daemon lifecycle), related C10 (idle/unused policy); Codex boundary: 002 D3/D5/D6. No policy change is approved.

## Reproduction

Not reproduced, because the one-minute load average was 24.31 on 24 logical CPUs. The explicit triage load limit requires skipping live reproduction. No researcher, fixture, daemon restart or test run was started. The load measurement does not establish the cause of the reported incident.

Verified by command: `cat /proc/loadavg` returned `24.31 30.71 20.96 20/2404 2831691`; `getconf _NPROCESSORS_ONLN` returned `24`.

Read in issue: reporter used Squeal 0.1.377. It reported no validation at revision 0, then validation again at revision 3 after edits without explicit restart. The subsequent targeted wait returned current results after 44.1 seconds. No outage-time JSON, daemon identity, stop note or socket evidence was saved. These are reported observations, not a reproduction here.

Read in source: origin/main package.json is 0.1.378; this session's installed skill is pinned to 0.1.377. `src/core/delivery/liveness.ts` classifies an old heartbeat as down and also handles known quiet rest separately. `src/core/delivery/format.ts` renders the generic down/recovery headlines. C9 describes idle/unused exit, restart and recorded shutdown evidence. These mechanisms make several explanations possible; they do not identify this incident as idle exit, crash or delayed heartbeat.

## Duplicate check

Read in GitHub and board: no #128 row exists. Open, triaged #109 and row gh-109 already request evidence-based liveness classification and recovery explanation. Its research reproduced a delayed-heartbeat diagnostic mismatch on 0.1.365, not this incident. This is substantial symptom and outcome overlap; treat #128 as additional evidence for gh-109 unless the human wants a separate lifecycle investigation. No distinct defect is proven. Open #27 concerns session-end ownership; #126 concerns stop after root deletion; neither is this symptom. No file paths were named in #128.

Exact intake commands: `git fetch origin`; `gh issue view 128 --repo hearsay-tools/squeal --json state,title,body,url,labels`; `git show origin/main:docs/board.md`; `rg -n -i '#128|no daemon|heartbeat|unused|idle' /tmp/issue128-board` (the temporary file contains origin/main's board); `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels`; `gh issue list --state open --label triaged --search 'daemon' --json number,title`; `gh issue view 109 --json body,title`.

## Human decision

Merge the evidence with gh-109's diagnostic work, or approve a separate bounded lifecycle investigation. Known stop reasons and supported recovery should be shown consistently in text and structured state; unknown reasons must remain unknown. Distinguish expected rest, explicit stop, confirmed exit and stale heartbeat without claiming that a responsive socket proves validation progress. Existing holds stand. No implementation is dispatched.
