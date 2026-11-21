# Issue 261: upstream fast-forwards queue broad validation

Triage evidence, 2026-11-21. Documentation only; no live experiment or researcher dispatched.

## Fit and owner

Inferred: passes the vision decision filter if it reduces upstream-only validation cost and notices while preserving uncertainty and result provenance. Owner: 011 core C2 (revisions), C3 (keys), C4 (scheduling and validity), C6 (status), C10 (capacity). Related: 018 D3–D6, D10, D14–D16 (CI import, matching and trust). A generic green CI commit is not per-file evidence for the local environment.

## Reproduction verdict

Not reproduced, because the one-minute host load was 24.85 on 16 online logical CPUs. The human explicitly requires skipping live reproduction above the CPU count. No probe was created, no tests ran, and no alternative host was used. The incident remains reporter evidence, not independently verified.

Reported Squeal version: 0.1.584. Session runtime: 0.1.584, from the session-pinned runtime path. Fetched origin/main package version: 0.1.585. Host observation: 2026-11-21 10:39 Europe/Warsaw, from `uptime` (24.85, 15.75, 9.44); `getconf _NPROCESSORS_ONLN` returned 16.

## Evidence

- Read in issue #261: a coordinator with no authored edits repeatedly ran `git merge --ff-only origin/main`; reported queues were 472, 1,803 and 1,855 test files. After about 146 minutes, 166 of the first 472 files lacked results. A child reported 1,636 queued files and ran `squeal stop --until-start`. Original revision records, CI imports and matching local keys were not examined.
- Read in spec: 011 C4 promotes stored results only at matching keys and queues misses after revisions. C2 reconciles HEAD moves; C3 treats commits as provenance rather than keys. 018 D3/D4 imports results at exported keys; unmatched local keys remain unused. D5 exposes mismatch reasons. These contracts do not grant a blanket current pass from a branch name or green workflow.
- Read in prior findings: `issue-204.md` partially reproduced upstream-only queueing on 0.1.457 (11 source-dependent files; all 12 after a config change; unchanged-key control stayed current). This is earlier evidence, not a reproduction of #261 on 0.1.584 or under overload.

## Duplicate verdict

Read in origin/main board and open issue list: no #261 row existed. Existing gh-204 covers the same upstream-only broad queueing symptom and deferral policy. Update that row with gh-261 as a second key rather than add a parallel proposal. #261 adds clean fast-forwards, repeated late notices and claimed base CI evidence. Shared root cause is unproven; keep both issues open pending the human's policy decision. Related triaged issues: #168 inherited lint Stop holds, #150 read-only startup, #245 broad local-edit backlogs, #249 manifest selection and #229 test discovery after rebases. The issue's `packages/cezar/scripts/mock-acp.mjs`, `packages/cezar/src/core/backend-detect.test.ts` and `packages/cezar/src/core/backend-detect.ts` had no board match.

## Exact intake commands

```sh
git fetch origin
gh issue view 261 --repo hearsay-tools/squeal --json state,title,body,labels,url
uptime
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md > /tmp/issue-261-board
rg -n '#261|fast-forward|gh-249|gh-245|^## Triage|^## Standing' /tmp/issue-261-board
rg 'gh-204|mock-acp|backend-detect' /tmp/issue-261-board
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue view 204 --repo hearsay-tools/squeal --json body,title
```

## Human decision

Choose whether upstream-only changed-key misses should stay stale/unknown until demand, or run at lower priority without authored-edit late notices; decide whether to investigate why matching CI imports were unavailable. No implementation is authorized. Require normal validation for later authored edits, honest missing/mismatched CI evidence, and preserved capacity limits and provenance. Existing holds stand.
