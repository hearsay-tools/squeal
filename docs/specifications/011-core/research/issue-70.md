# Issue 70: recorder assets across plugin upgrades

Date: 2026-10-21. Source: [issue #70](https://github.com/hearsay-tools/squeal/issues/70), an agent-reported `friction` issue.

## Fit and owner

Inferred: passes the vision decision filter. Keeping instrumentation available protects trustworthy validation, reduces false failure noise and preserves uncertainty. Spec 011 owns the shared recorder and daemon lifecycle: C9 (upgrade handoff), C10 (recorder fidelity and failure notes), C12 (runtime-input recorder), C13 (error handling). C4/C5/C6 cover pending work, result state and status. No policy or spec amendment is made here.

## Evidence and reproduction verdict

Issue report, not independently verified: an upgrade from Squeal 0.1.235 to 0.1.236 deleted the old plugin directory while a validation tier still launched descendants with its recorder path. The report names `dist/observe/recorder.cjs`, `ERR_MODULE_NOT_FOUND`, 12 worker-wait failures, and assertion timeouts at `packages/cezar/src/workflows/worker-wait.testkit.ts:34:46`. Its log reference is `/home/agent/projects/cezar/.git/squeal/runs/c69f960b-a385-45a6-8749-69ad0368dff4/vitest.log`, revision 25, head `ec9ecd991`. This triage did not inspect or replay that log.

Not reproduced, because the one-minute host load was 61.24 on 24 CPUs. No live reproduction, researcher or probe was dispatched. The checkout package version and session CLI path name Squeal 0.1.236. This does not prove the reported root cause or that existing handoff work fails to address it.

Exact intake commands (read-only; no reproduction command was run):

```sh
git fetch origin
git show origin/main:docs/board.md
gh issue view 70 --repo hearsay-tools/squeal --json state,title,body,labels,url
python3 -c 'import os; print(os.getloadavg(),os.cpu_count())'
cat package.json | head -12
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels --jq '.[] | [.number,.title,([.labels[].name]|join(","))]|@tsv'
gh issue view 47 --repo hearsay-tools/squeal --json body --jq .body
gh issue view 48 --repo hearsay-tools/squeal --json body --jq .body
```

The load command returned `(61.24072265625, 69.453125, 62.640625) 24`.

## Duplicate check

Read in board and issue text: no existing #70 row or exact duplicate among open issues, including those labelled `triaged`. The origin/main board was searched for `#70`, `recorder`, `upgrade`, `deleted`, `worker-wait` and `recorder.cjs`; the issue's named paths were compared with the related rows. #48 concerns session skill and CLI paths after cache removal. #47 and rows 011-30 through 011-34 concern daemon handoff and pending-work recovery. Done 009-18 concerns Pi version retention. These overlap in upgrade lifecycle but do not explicitly cover the recorder path used by live descendants. Keep these links with gh-70 so approval can decide whether to fold it into existing work.

## Human decision

Approve or decline a bounded recorder-lifetime and recovery change. If approved, choose retained assets through active descendant exit or a safe restart with the new recorder, and decide how missing instrumentation is distinguished from product assertion failures. Future regression evidence must cover removal of an old plugin directory during an active tier, a later descendant spawn, pending-work recovery and honest failure classification. Existing holds stand. This proposed row authorizes no implementation.
