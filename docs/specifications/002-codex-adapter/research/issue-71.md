# Issue 71: repair edits after regression notices

Date: 2026-10-21. Issue: https://github.com/hearsay-tools/squeal/issues/71

## Verdict

Not reproduced, because the one-minute host load was 24.36181640625 on 24 CPUs. The human requires skipping live reproduction above the CPU count. No researcher was dispatched and no probes ran.

## Versions and evidence

- Reported by an agent using Squeal 0.1.236 in hearsay-tools/cezarion with `interrupt.onRegression: true`. The issue reports 91 changed checks after `ResizeObserver is not defined` in jsdom. A guard edit was denied, then the same edit succeeded on retry. This is an issue report, not independently verified evidence.
- Checkout `package.json`: Squeal 0.1.237. Session plugin: 0.1.237, from its supplied absolute CLI path. Neither was exercised for reproduction.
- Verified by host inspection: load averages `(24.36181640625, 38.236328125, 34.38525390625)`; CPU count `24`.

Exact intake commands (no live reproduction commands):

```sh
git fetch origin
gh issue view 71 --repo hearsay-tools/squeal --json state,title,body,labels,url
python3 -c 'import os; print("load",os.getloadavg(),"cpus",os.cpu_count())'
git show origin/main:docs/board.md | rg -n -i '#71|repair edit|PreToolUse|ResizeObserver|regression notice|deny.once|hook-levers'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title --jq '.[] | [.number,.title] | @tsv'
```

## Fit and ownership

Read in spec: 002 goal 3 and D3 explicitly deny the next `apply_patch` once after an undelivered regression and ask the agent to reissue it. D8 binds that deny to `interrupt.onRegression`. D3 also caps model-visible reports at 8,000 characters. The reported retry is consistent with the contract; this does not verify the incident or its repeated failure output.

Spec 002 owns the Codex edit behavior (goal 3, D3, D8). Related spec 011 C5/C6/C8/C10 owns delivery views, status and evidence, the shared hook contract and policy. Grouping by error and source location must retain per-check provenance and accessible full evidence. The request passes the vision filter: less noise and unnecessary blocking, useful transition feedback, explicit policy, and full evidence on demand.

## Duplicate check

No #71 row and no exact symptom duplicate found on origin/main's board or in open issues, including `triaged`. The issue names no project file paths. Searches covered `ResizeObserver`, `PreToolUse`, repair edits, regression notices and deny-once wording. Done row 002-12 implements the deny-once contract; it is related shipped behavior, not an existing proposal for removing the retry. Done 005-03 researches hook levers, not this acceptance contract. Done 011-02 bounds invalidation paths, not shared-error failure groups. Open #67 and #54 concern failure history; #70 concerns missing recorder assets. None requests repair-edit delivery or grouping of identical errors.

## Human decision

Approve or decline changing the deny-once contract so a repair edit proceeds after its regression notice without an identical retry, together with grouped failure notices. Define a delivery contract that preserves visible regression evidence without requiring Squeal to infer whether an arbitrary patch is a repair. Keep completion-blocking policy unchanged. Existing holds stand. This triage authorizes no implementation or spec amendment.
