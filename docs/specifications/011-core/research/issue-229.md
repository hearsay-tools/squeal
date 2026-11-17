# Issue 229: test files arriving through a rebase stay unlisted

## Verdict and fit

Not reproduced, because the one-minute host load was 35.02 on 24 CPUs. Live reproduction was skipped under the human’s triage rule. No researcher or probe was started, and no tests were run for this documentation-only triage.

Inferred: this passes the vision’s decision filter: complete inventory and truthful named-file status strengthen current validation evidence across harnesses without adding passing-test noise. Owner: 011 C2 (watcher/reconciliation), C4 (runner refinement and listing), C6 (status), C9 (lifecycle), C15 (named demand); related adapter contract 013 V2/V3/V7. The proposed HEAD reconciliation and demand-triggered discovery are suggestions, not approved designs.

## Evidence

Read in issue [#229](https://github.com/hearsay-tools/squeal/issues/229): reporter used Squeal 0.1.523 in a Squawk Codex worker. Five tracked `packages/cezar/src/workflows/automation-tools-{claude,codex,opencode,pi,omp}-parity.test.ts` files arrived through a rebase. Four bounded waits and a run-loop request gave no own verdict at revisions 32–60. Restart reportedly increased inventory from 1,895 to 1,903 and the group from 307 to 312; the five files then passed at revision 61. The full pre-restart output was not retained. These are reported observations, not independently verified results.

Read in repository metadata: origin/main package version is 0.1.531; this session’s installed runtime is 0.1.526. No claim is made that either version reproduces or fixes the incident.

## Commands and load

Triage commands (2026-11-17 UTC):

```sh
git fetch origin
git show origin/main:docs/board.md
gh issue view 229 --repo hearsay-tools/squeal --json state,title,body,url,labels
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue view 161 --json body --jq .body
gh issue view 142 --json body --jq .body
```

Observed load output: `35.02 19.81 16.33`; CPU count: `24`.

Reported incident commands (placeholders are from the report, not executed here):

```text
squeal status --wait 60000 <the five automation-tools-*-parity.test.ts files>
squeal run run-loop <same files> --wait 60000
squeal stop; squeal start
```

## Duplicates and human decision

Read in origin/main board and open issues, including `triaged`: no existing #229 row or exact rebase-added inventory duplicate. #161 has the same missing-own-inventory symptom after local creation/commit, but no verified common cause; its included-file reproduction did not fail. #142 covers pending-discovery wording and eventual recovery. #181 covers discovery latency, #180 narrow-run freshness, and #204 upstream rebase queue scope. Keep these linked; do not claim distinct mechanisms or merge them without evidence.

Human decision: approve a bounded rebase/fast-forward discovery investigation, coordinated with #161/#142, or defer it. Before choosing a repair, capture resolved runner include/exclude settings and inventory/refinement state before and after HEAD moves. Acceptance should cover tracked additions via rebase and fast-forward, named/group requests, genuine exclusions and pending discovery. Each new included test must obtain its own current verdict without restart, or have an explicit truthful pending/blocked state. A consumer’s pass cannot replace it. Existing holds stand; this triage authorizes no implementation.
