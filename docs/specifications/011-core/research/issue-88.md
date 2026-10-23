# Issue 88: verdicts for fully current selected tests

## Fit and owner

Inferred: passes the vision decision filter. Consistent selected-file verdicts improve trust and remove unnecessary waits across harnesses. Spec 011 owns C5 (state and retry semantics), C6 (status and named verdicts), and C15 (named demand). No spec or skill change is authorized by this triage.

## Evidence and reproduction

Reported in [issue #88](https://github.com/hearsay-tools/squeal/issues/88), labelled `friction` by an agent: Squeal 0.1.278 returned exit 3 and “Named test files have no verdict” for 24 selected files. The same JSON reportedly showed all 24 current and passing, with no pending, stale, unknown, unmatched or failed selected files. An unrelated failed test had a load retry queued. The report links cezarion#1542 and PR cezarion#1548. This is reported evidence, not an independently verified response or cause.

Not reproduced, because the one-minute host load was 45.45 on 24 online CPUs. No researcher, live probe or fixture was started. Checkout and session Squeal version: 0.1.279. Incident version: 0.1.278. The load hold applies even though a small reproduction would likely fit the 20-minute budget.

Exact intake commands and output:

```sh
git fetch origin
gh issue view 88 --repo hearsay-tools/squeal --json state,title,body,labels,url
# state: OPEN
getconf _NPROCESSORS_ONLN
# 24
cat /proc/loadavg
# 45.45 27.69 26.23 54/4792 2892968
cat package.json | head -12
# "version": "0.1.279"
```

Read in specification: C5 separates outcome from validity and retains a failed test in known failures while an explicit retry is pending. C6 owns status and selected-file verdicts. C15 changes scheduling order without changing whether a result is current. These sections identify ownership; they do not prove the reported mismatch or its cause. No product source was changed or runtime test executed.

## Duplicate check

Read in origin/main board and GitHub metadata: no existing #88 row or exact open-issue duplicate, including issues labelled `triaged`. Searched the fetched board for `#88`, `gh-88`, selected/named verdict wording, and status filename terms. The issue names no Squeal source file or selected test paths. Exact discovery commands:

```sh
git show origin/main:docs/board.md | rg -n -i '#88|gh-88|named.*verdict|selected.*verdict|status\.ts|named-files'
gh issue list --repo hearsay-tools/squeal --state open --limit 150 --json number,title,labels,body
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 150 --json number,title
```

Open #84 / gh-84 concerns interpreting freshness as a pass. Here the report says both freshness and per-file outcomes already indicate passes. Open #82 requests refresh-and-wait; #87 concerns blocked revision waits; #41 concerns idle/queued wording. Done gh-65 / 011-63 unified selected JSON paths. These overlap but do not cover the reported fully current selection blocked beside an unrelated retry. No rows are merged by this intake.

## Human decision

Decide whether to approve selected-file verdict isolation from unrelated failures and pending retries. The proposed done-when is exit 0 for a fully current passing selection and exit 1 for a fully current failing selection, with named waits completing once selected results are current. Text, JSON selection fields and exit codes must agree. Any global condition that must block the selection must be explicit and represent it as pending. A regression must place an unrelated load retry beside a current passing selection. Load thresholds and test assertions are out of scope. Existing holds stand. This proposed row authorizes no implementation.
