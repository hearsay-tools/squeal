# Issue 275: repeated repair-edit denials for one error signature

Triage evidence, 2026-11-24. Owner: 011 C5/C8/C10; related 002 goal 3,
D3 and Policy (original D8). Issue: https://github.com/hearsay-tools/squeal/issues/275.

## Verdict and environment

**Not reproduced, because** the pre-reproduction one-minute host load was
16.03, above 16 online CPUs. The human explicitly requires skipping a live
reproduction in this case. No researcher, probe, test, remote reproduction or
product change was dispatched. Earlier readings were 15.84 and 14.95; the
pre-reproduction reading was `16.03 16.34 17.62`. This is a load observation,
not evidence of the reported defect.

Reported versions: daemon **0.1.606**, CLI **0.1.611**. This session's registered
Squeal runtime is **0.1.611**. The incident reports four lost turns reissuing
`edit_file` at revisions 3, 4, 6 and 8. Different background test files reportedly
failed with `factsWhere is not defined` at
`packages/cezar/src/core/harness-parity-core.testkit.ts:542:3`, while the denied
edit was intended to replace the remaining usages after import removal.
These are reporter claims, not independently verified observations.

## Fit, ownership and duplicate verdict

**Inferred from the issue and vision:** this passes the decision filter by
reducing unnecessary blocking and repeated noise while preserving trustworthy,
revision-aware feedback. A shared denial-policy change belongs to 011 C8/C10;
C5 owns diagnostic grouping and delivery views. The reported harness is
“Other or none”; `edit_file` alone does not identify an adapter. 002 D3 and
original D8 document a related mapping, not proof that Codex handled this event.

**Read in repository docs:** 011 C8 specifies one denial per seen regression,
using a peek that consumes regression entries. Existing row `gh-71` already
holds the repair-edit policy decision, with #136, #215 and #263 as evidence.
011-109 shipped diagnostic grouping in 0.1.262 without changing deny-once.
The prior [issue-263 research](issue-263.md) records a synthetic reproduction
of successive *new* regression batches causing successive denials. That is
prior evidence, not a reproduction of #275 or its versions.

**Duplicate verdict:** #275 belongs on `gh-71`, especially its #263 evidence;
no separate row. Board searches found no #275 reference or incident testkit
path. Open-issue searches, including `triaged`, found #71/#136/#215/#263.
The narrower question—whether the same diagnostic across distinct checks
should be acknowledged together—remains unverified. The same error text does
not prove that the same regression entry was delivered twice.

## Exact intake commands

```sh
git fetch origin
gh issue view 275 --repo hearsay-tools/squeal --json state,title,body,labels,url
git show origin/main:docs/board.md | rg -n -i '275|regression|factsWhere|harness-parity|## Triage|Standing models|hold'
gh issue list --repo hearsay-tools/squeal --state open --search 'regression' --json number,title --limit 100
gh issue list --repo hearsay-tools/squeal --state open --label triaged --search 'interrupt' --json number,title --limit 100
gh issue view 71 --json body
gh issue view 136 --json body
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
```

No live reproduction command ran. No probe directory was needed.

## Human decision

Keep the existing hold, or approve revisiting `gh-71`'s deny-once contract
using this further post-grouping retry cost. Signature deduplication and a
repair-target exception are the reporter's proposals, not accepted designs.
Any approved rule must retain distinct actionable failures, provenance,
recovery and completion gates. Existing holds stand; this triage authorizes
no implementation or dispatch.
