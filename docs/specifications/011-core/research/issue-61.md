# Issue 61: name running and queued test files

## Fit and owner

Inferred: passes the vision decision filter. File identity makes pulled status actionable, reduces extra commands and keeps pending work distinct from results. Spec 011 owns this: C6 (text and JSON status), with C15 (named pending files). Spec 010 D12 governs intake only.

## Evidence and reproduction

Issue report, not independently verified: the reporter used Squeal 0.1.233 on 2026-10-20 in hearsay-tools/cezarion PR 1369. `squeal status` showed `5 running, 51 unknown` and `740 tests (740 running)`. `squeal status --json` showed `"testFilesByPhase": {"running": 5, "queued": 0}`. Finding the suspected long-running `packages/cezar/src/core/harness-parity.test.ts` took four more commands and remained a guess. The issue gives no exact original root or full invocation arguments.

Verified by host observation during triage: `cat /proc/loadavg` returned `40.38 41.76 32.12 22/3179 3334037`; `getconf _NPROCESSORS_ONLN` returned `24`. The one-minute load exceeded the CPU count.

Not reproduced, because the human's load rule requires skipping live reproduction above the CPU count. No researcher, probe, status invocation or test run was started. The reported version is 0.1.233; no live version was tested.

## Duplicate check

Read in repository docs: after `git fetch origin`, searched origin/main's board with `rg` for `#61`, `gh-61`, running/queued files and paths, `testFilesByPhase`, `status.ts`, and `harness-parity`. No existing issue-61 row or exact duplicate was found. 011-26 adds phase counts; 011-12/C15 names files in a selected wait; 011-29 changes the status layout and groups outstanding work. None explicitly requires the requested global path/project lists beside the counts.

Read in GitHub issue data: `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` included the open issues and their `triaged` labels. No exact duplicate. Related #51 concerns queue priority, #41 idle/queued wording, #58 the slow-slot holder, #65 selected-verdict JSON. These do not replace this request.

## Human decision

Approve or decline global running and queued path/project lists in text and JSON, keeping counts and stating the omitted-file count for any cut list. If approved, coordinate with 011-29's status layout rather than widening its running row now. Existing holds stand. No implementation is authorized by this triage.

Done when: plain status identifies running and queued files with their projects; JSON adds both lists beside the retained counts; every cut list states how many files it omits.
