# Issue 187: shared-identity gate collection cost

Date: 2026-11-11. Documentation-only triage of [#187](https://github.com/hearsay-tools/squeal/issues/187). No live reproduction or product changes.

## Fit and owner

**Inferred:** passes the vision decision filter: bounded feedback and reusable evidence reduce agent waiting while keeping incomplete evidence honest. Spec 020 owns the one-shot gate: D1 command and budget, D3 selection/collection, D5 completeness, D7 report, D11.7 keyed store reuse, D14 scope, and D17 wide selections and persisted completed records. Existing holds and completeness rules stand.

## Reported evidence

**Read in issue, not independently verified:** Squeal 0.1.430 on cezarion HEAD `40edbdecf80811272b78256aebda6c400cb7445d`, clean; background revision 7 before unrelated merges. Exact reported command:

```sh
squeal code --base origin/main --json --timeout 5400 --test scripts/release-install-metadata.test.mjs
```

Selection: 1,330 Vitest and 21 node:test files. After 5,400 seconds: 35 pass, zero violations, 29 incomplete, timedOut true; 21 browser and seven Node files unfinished. Stderr reported 175 of 1,351 selected files read from stores. Earlier 600- and 1,800-second attempts were incomplete; a fourth was cancelled after roughly an hour when independent repair work merged. This proves neither an invalid selection nor a scheduling cause. No local gate pass was claimed. The separate store-lock incident is #186.

## Reproduction verdict

**Not reproduced, because** the reported 90-minute collection and earlier 30-minute attempt exceed the roughly 20-minute triage budget; a smaller synthetic probe would not establish completion of the reported shared-identity selection. No researcher or probe was started. Initial host one-minute load was 21.90 on 24 online CPUs; a later read was 21.07. Load alone did not prohibit reproduction. Installed session runtime is 0.1.432; this is not evidence that the incident persists on that version or on the candidate implementing D17.

Exact intake commands (no collection executed):

```sh
git fetch origin
gh issue view 187 --repo hearsay-tools/squeal --json state,title,body,url
git show origin/main:docs/board.md
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue view 175 --repo hearsay-tools/squeal --json title,body
```

## Duplicate verdict and decision

**Read in board and issues:** no prior #187 row. Open, triaged #175 already owns wide-import gate cost in row 020-17. This is a duplicate of that core symptom with new 90-minute, multi-runner evidence. #172 selection and browser setup is related and closed; #186 store locking is separate. Board searches included #187, identity, pre-PR, collection, resume, missing loaders, 5400 and `release-install-metadata`.

**Read in spec and board:** D17 already approves estimates, loader order and persistence of completed keyed records; 020-17 is in review as cand/0.1.433, not a released fix verified here. `research/wide-import.md` models broad-loader cost but leaves real large-run measurements unverified. Do not dispatch duplicate implementation.

**Human decision:** fold #187 into #175/020-17 as follow-up validation evidence, and decide whether fair progress across runners (the request to run short Node evidence before a broad browser batch consumes the budget) needs a separate bounded design. Do not weaken full-loader completeness, limits, scope provenance or changed-input invalidation. Validate identical-key reuse and eventual completion of remaining loaders after D17, with an approved budget; estimates must appear before expensive collection. No new implementation is authorized by this triage.
