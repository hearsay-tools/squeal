# Issue 103: new nondeterminism presented as a load flake

Date: 2026-10-26. Issue: https://github.com/hearsay-tools/squeal/issues/103.

## Fit and owner

Inferred: passes the vision decision filter. Reliable failure provenance helps an agent act on changed code. Spec 011 owns this under C5 (known state, flaky notes, retry advice), with C3/C4 (tracked inputs and changed-file selection), C6 (status), and C7 (stored provenance) as supporting sections. Spec 010 D12 owns intake only.

## Evidence and limits

Read in issue: the reporter saw revision 54 fail `packages/cezar/src/preview/host-teardown.test.ts` after edits to imported `packages/cezar/src/core/detached-process.ts`. `squeal why` named load 2.56 per CPU and led with `squeal retry --reason load`. A later pass produced a same-input flaky note. The reporter says no pass existed at these inputs before the failure; 42 earlier passes belonged to other inputs. The reporter attributes the failure to a new process-exit race repaired in cezarion commit `d76cfcc2e`. These incident claims were not independently reproduced. Incident version was not recorded; the issue states current version 0.1.345.

Read in specification: 011 C5 records a flaky note for opposite outcomes at one key. Its load advice names a load retry for a failure recorded at or above one load per CPU with no retry asked. Neither rule requires a pass at the key before the failure. This is consistent with the reported advice, but does not establish the incident's stored history. C5's #98 amendment qualifies tracked inputs; it does not establish when nondeterminism began.

## Reproduction verdict

Not reproduced, because the one-minute host load was 45.63, above 24 CPUs. No researcher or live probe was started. Checkout version: 0.1.349. No test suite was run for this documentation-only triage.

Exact intake commands (from the task worktree):

```sh
git fetch origin
git show origin/main:docs/board.md
gh issue view 103 --repo hearsay-tools/squeal --json title,body,state,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title
gh issue view 98 --repo hearsay-tools/squeal --json state,title
```

Load output: `45.63 42.87 40.03 73/5169 2714078`. CPU output: `24`.

## Duplicate verdict and decision

Read in board and issue list: no existing #103 row or exact duplicate among open issues, including `triaged`. Searched origin/main's board for #103, flaky/same-input/load-retry symptoms, host-teardown and detached-process. Closed #98 / done 011-244 overlaps in presentation only: untracked inputs versus whether a pass at the current inputs preceded the failure. Done 011-67 / #52 owns load-retry advice; done 011-213 / #92 owns its defer bound. Neither covers this distinction. Open #56 concerns missing tracked inputs, not pass ordering at one key.

Human decision needed: whether to record and expose pass-before-failure evidence at the current inputs, qualify the first fail/pass flip after an import-graph edit, and lead with inspection of changed files instead of a load retry when that evidence is absent. A same-key flip proves differing outcomes under tracked inputs; it alone proves neither the cause nor that this edit introduced the race. Missing history must stay unknown. Existing holds stand. This row authorizes no implementation.

Done when: a first failure after an edit in the test's import graph, with no earlier pass at those inputs, leads with changed-file inspection and states the absence of prior pass evidence. A later pass retains the same-tracked-input flip evidence without implying a harmless load flake. Established same-input pass history can still support load-retry advice. Regression evidence covers earlier passes at other keys/worktrees, earlier passes at the current key, absent/pruned history, and consistent why/status/notice output.
