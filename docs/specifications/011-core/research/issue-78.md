# Issue 78: browser lease lifetime and named slow-file demand

Date: 2026-10-23. Issue: https://github.com/hearsay-tools/squeal/issues/78

## Fit and owner

Inferred: passes the vision decision filter. Releasing an unused environment reduces blocking. Daemon-owned file demand can give earlier evidence with revision provenance. Spec 011 owns scheduling and named demand (C4/C6/C14/C15); spec 004 D2/D3/D4/D8 owns slow-lane execution, load policy and verdict limits; spec 013 V1/V7/V8 owns Vitest instance/setup lifetime. Findings live under 011 as the intake's core owner.

## Reproduction verdict

Not reproduced, because the one-minute host load was 68.44 on 24 online CPUs. The user requires skipping live reproduction above the CPU count. No researcher or live probe was started. No claim is made that the reported lease is still held on the current version.

Read in issue: the incident used Squeal 0.1.273. The agent reported a 37-minute daemon, about 480 fast files queued, 83 slow files pending, and the browser environment lease held by daemon pid 1569623 while slow work waited for fast files. Its manual command was `npm run test:e2e -- live-preview.e2e.ts`; it timed out waiting for that pid. Paths named: `packages/web/e2e/live-preview.e2e.ts` and `.ai/scripts/test-env-lease.mjs`. These are cezarion paths, not Squeal files verified in this checkout.

Read in package metadata: this checkout is Squeal 0.1.276; the session's registered plugin is also 0.1.276.

Exact intake commands (no reproduction commands executed):

```sh
git fetch origin
gh issue view 78 --repo hearsay-tools/squeal --json state,title,body,labels,url
uptime
getconf _NPROCESSORS_ONLN
cat package.json | head -15
git show origin/main:docs/board.md | rg -i '#78|gh-78|test-env-lease|live-preview|\blease\b|named slow'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue view 79 --json body
gh issue view 64 --json body
gh issue view 60 --json body
```

Observed command output: `load average: 68.44, 54.82, 51.45`; CPU count `24`; package version `0.1.276`.

## Duplicate verdict and boundaries

Read in origin/main board and open issue list, including `triaged`: no gh-78 row or exact duplicate. Open #79 requests fast-file queue priority, not slow-file demand or environment release. Open #64 / 011-135 selects checks within fast files; its design awaits human acceptance and implementation remains unauthorized. Open #60 / 013-04 refreshes browser preparation after source edits, with implementation held for design acceptance. Neither establishes the cause of this lease report.

Read in board: dropped gh-46 / closed #46 addressed shared-browser collisions; the human placed the server lease in cezarion#1304. That decision stands. Do not assume a project lease is Squeal's slow-slot permit, or move lease ownership into Squeal without evidence. Done 004-11/004 D2's permit lifetime and closed #4's affected-first ranking are related, not duplicates of explicit named-file execution.

Read in specs: 004 D2 keeps a separate slow instance until the lane drains; 013 V1 describes warm instance lifetime. This makes setup lifetime relevant but does not prove why the reported project lease remained held. 011 C15 distinguishes named slow waits and environment retry guidance from focused fast checks. An idle lease report is not evidence that every named slow file lacks a supported retry route.

## Human decision

Decide whether to approve bounded research/design for named slow-file execution and idle setup release, or keep the lease repair project-side under the existing #46 decision. Before implementation, settle the command, load/fast-work policy, setup release boundary and explicit partial-lane verdict. Preserve all existing holds. No code, spec amendment or implementation dispatch is authorized by this triage.

Done when: no browser file running means no daemon-held project environment lease; one command runs only named slow files and records their current-revision results; help states exclusions and that the result is not a full slow-tier pass.

Validation: documentation-only scope; no test or build command run. Live reproduction skipped under the required load guard.
