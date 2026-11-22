# Issue 266: proof has no recovery step for a missing commit closure

Date: 2026-11-22. Source: https://github.com/hearsay-tools/squeal/issues/266 (agent-reported `friction`).

## Fit and owner

Inferred: passes the vision decision filter. An actionable, provenance-aware proof result reduces manual test work without claiming evidence that is missing. Owner: 023 results at commit, D2, D5.1/D5.2/D5.5/D5.6 and D7.6. The intake area-core label does not change that ownership.

## Evidence and reproduction

Reported, not independently verified: Squeal 0.1.597 returned `not comparable (its closure at the commit is not stored for its key)` with zero runs for a filesystem-reading test. Both a sibling base and a child of HEAD failed, including after a current working-tree pass. The reporter obtained red evidence in a scratch worktree with its own daemon. No proof JSON was saved. Checkout package version at triage: 0.1.598; no claim that it fixes this report.

Not reproduced, because the one-minute host load was 17.07, above 16 online CPUs. The human explicitly requires skipping live reproduction in this condition. No researcher, test process or probe was started, locally or remotely.

Exact intake commands:

```sh
git fetch origin
gh issue view 266 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:package.json
```

Load output: `17.07 12.13 9.50 26/2068 2311110`; CPU output: `16`.

Reporter command (not run here):

```sh
squeal proof packages/cezar/src/contract-owner-imports.test.ts --base aeefd5ff3 --case source --source packages/cezar/src/archive-on-merge-setting.ts --source packages/contract/src/activity.ts
```

Reported HEAD: `684b1a933`. The issue attributes the message to `keyAt` -> `loadsOf3` in bundled proof-green-rows; that diagnosis is not verified here. A working-tree pass does not establish that the separate commit daemon stored the required closure (inferred from D7.6); the reason it was absent remains open.

## Duplicates and decision

Read in board and issue metadata: origin/main has no #266 row, exact missing-closure symptom or row naming the three reported paths. Checked open issues, including `triaged`, with `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels`. No exact duplicate found. #264 concerns reuse of a stored break-side pass; #257 concerns explicit source selection for spawned mock scripts; #256 concerns imported testkit side selection. These are related, not established shared causes. Done row 023-42 owns the commit-daemon green side; it does not establish a fix for this report.

Human decision: approve bounded diagnosis and an actionable missing-closure recovery path, or defer until original proof JSON and commit-daemon evidence are available. Whether recovery queues the needed daemon run or uses a temporary checkout needs that decision; preserve exact-key reuse, explicit source/test classification and honest uncertainty. Existing holds, including the unreleased 0.1.598 hold, stand. No implementation is authorized.

Done when: a filesystem-reading test with explicit product source paths either obtains a correct red/green verdict from the right side keys, or explains why its commit closure is missing and gives an exact supported recovery command. A current working-tree pass must not be presented as commit-side evidence.
