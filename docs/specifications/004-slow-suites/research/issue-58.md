# Issue 58: identify the slow-slot holder

Date: 2026-10-20. Issue: https://github.com/hearsay-tools/squeal/issues/58

## Fit and ownership

Inferred: passes the vision decision filter by making pending validation actionable across harnesses and reducing duplicate manual runs. Spec 004 owns the slot (D2) and its reporting (D8); spec 011 C6 owns the status interface. Existing holds remain; this note authorizes no implementation or spec amendment.

## Reproduction verdict

Not reproduced, because the one-minute host load was **39.16 on 24 CPUs**, above the user's skip threshold. No researcher was dispatched and no live probe or test suite was run. The issue's reported 25-minute wait and 76 of 81 pending slow files are reporter evidence, not independently verified here.

Version: repository package.json on origin/main is **0.1.232**; this session's installed Squeal is **0.1.231** (registration command). The issue does not name its Squeal version.

Exact intake commands used:

```sh
git fetch origin
git rebase origin/main
gh issue view 58 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
```

Load command output:

```text
39.16 18.45 13.52 13/2235 687294
24
```

## Duplicate verdict

Read in repository documentation: origin/main's board has no #58 or holder-identification row. Searches for `#58`, `slow.lock`, `slow.slot` and `holder` find the existing slot implementation/release rows 004-11 and 004-30, not this requested diagnostic. The issue names a runtime lock path and manual command, not product source files.

Read in GitHub issue data: `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` and `gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title` show no exact duplicate. Open #51 concerns named-file queue promotion, not identifying another daemon holding a permit. `gh issue view 4 --repo hearsay-tools/squeal --json state,title,body` shows closed #4 covers ranking within a slow queue; it is related only to the optional prioritization request. Neither establishes cross-worktree priority policy.

## Decision needed

Approve holder diagnostics alone (worktree, pid, elapsed hold, running files and remaining count), defer, or also request a separate design for cross-worktree prioritization. Recommendation: keep prioritization separate from holder visibility. D2 permits multiple simultaneous holders, so any later design must identify the actual occupied permits without assuming one exclusive holder, preserve lock lifetime/crash recovery, and state uncertainty for stale or unavailable holder data. This is an inferred design constraint, not a verified implementation finding.
