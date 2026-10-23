# Issue 84: current freshness mistaken for a passing verdict

## Fit and owner

Inferred: passes the vision decision filter. Clear selected-file verdicts make validation claims more trustworthy across harnesses. Spec 011 owns the status interface: C5 (state and validity), C6 (status), C15 (named demand). Spec 005 D2 is related guidance, not a grant to change a skill.

## Evidence and reproduction

Reported in [issue #84](https://github.com/hearsay-tools/squeal/issues/84), agent-reported `friction`: a cezarion#1534 session counted 58 and then 59 `current` files as passing without reading `verdict`. A later verdict check showed all 59 passed. No incorrect claim shipped in that report. The incident's Squeal version is not stated. Checkout and session version: 0.1.278.

Not reproduced, because the one-minute host load was 71.05 on 24 online CPUs. No live reproduction, researcher, fixture or probe was started. This follows the explicit load hold. The original session and a current failing-file JSON response remain unverified.

Exact intake commands and observed output:

```sh
cat /proc/loadavg
# 71.05 66.35 69.03 115/5780 3514220
getconf _NPROCESSORS_ONLN
# 24
node -p 'require("./package.json").version'
# 0.1.278
```

Read in specification: 011 C5 separates `pass`, `fail`, `skip`, `unknown` from `current | stale | pending` validity. Current validity alone is not proof of a pass. This is a report of a consumer interpretation trap, not evidence that Squeal stored a false verdict.

## Duplicate check

Read in board and issue metadata: no existing #84 row and no exact duplicate among open issues, including those labelled `triaged`. Searched origin/main's board for `#84`, `gh-84`, current/pass wording, `named.testFiles`, `wait.testFiles`, `turn-end.test.ts` and `task-thread.e2e.ts`. Listed open issues with:

```sh
git fetch origin
gh issue view 84 --repo hearsay-tools/squeal --json state,title,body,url,labels
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

Closed #65 / done 011-63 addressed different JSON paths for selected files. It added a common selection key while retaining the old keys. It did not remove the freshness/verdict distinction. Closed #59 / 011-63 addressed mixed matched/unmatched selection. Open #41 concerns idle/queued wording; #82 requests selected-file refresh and wait; #87 concerns blocked revision waits. These overlap in status scope only. The issue names no Squeal source file; its two test filenames are from the reported consumer session.

## Human decision

Decide whether to approve an explicit aggregate selected-file verdict, change per-file state words, or request guidance only. Prefer an additive aggregate verdict for evaluation because existing JSON consumers may depend on the current fields; this is a proposal, not an accepted design. A future approved change must cover current passing and failing files, mixed selections, pending and unknown results, and preserve revision provenance and compatibility under the chosen contract. Existing holds stand. No implementation is authorized.
