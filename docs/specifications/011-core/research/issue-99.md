# Issue 99: selected passes beside no verdict

Date: 2026-10-25. Issue: https://github.com/hearsay-tools/squeal/issues/99.

## Fit and owner

Inferred: this passes the vision decision filter. Consistent status makes validation evidence trustworthy and preserves revision provenance across harnesses. Spec 011 owns it: C6 (one committed status snapshot) and C15 (named selection, result and reason). C4 supplies revision and result-validity rules; C13 supplies honest failure reporting.

## Evidence and reproduction

Read in the issue report, not independently verified: Squeal 0.1.318 in Codex printed nine selected files as current passes, then exited 3 because revision 7 had not been listed. The worktree changed branch during the wait. The report names commit af51acd13b7b377863707f5e04e6682b38e388d1 and a stale heartbeat with a live socket. The selected wait JSON was not kept. A separate status JSON at revision 7 had runnerPartPending true. It cannot establish the exact snapshot used by the selected wait. A manual run reportedly passed nine files and 23 tests.

Reported command (not run here):

```sh
squeal status --wait 60000 packages/cezar/src/server/contract-parity*.test.ts packages/cezar/src/server/typed-bodies.test.ts
```

Not reproduced, because the one-minute host load was 28.80, above 24 online CPUs. No researcher, live reproduction or probe was started. Checkout and session Squeal version: 0.1.321. Incident version: 0.1.318. The cause remains unknown; the report does not prove that two read transactions were mixed. A pending listing can itself block a verdict under the current contract.

Exact intake commands for version and load:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
```

Outputs: `28.80 27.65 26.41 30/3096 1937345`, `24`, `0.1.321`.

## Duplicate check

Read in origin/main board and open GitHub issues, including triaged issues: no #99 row or exact branch-switch presentation duplicate. Searches covered #99, selected waits, no verdict, current/pass, contract-parity and typed-bodies. No board row names those reported test files.

Issue #88 overlaps strongly: all selected files current/pass beside exit 3. Its row 011-206 is done in 0.1.318 and defines one result function for text, JSON and exit code, including an unlisted reason. Its original trigger was an unrelated queued retry. Issue #99 reports the same version after a branch switch with a pending listing, and asks that the displayed file classes explain the revision limit. Treat this as a related follow-up pending reproduction, not proof that #88's repair failed. Issue #87 and rows 011-209/011-210 concern blocked-revision progress and recovery, not this final response's apparent contradiction. Issue #84 concerns freshness versus verdict fields in JSON.

Commands: `git fetch origin`; `git show origin/main:docs/board.md` with the search terms above; `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels`; `gh issue view 99 --repo hearsay-tools/squeal --json state,title,body,labels,url,comments`; `gh issue view 88 --json body`; `gh issue view 87 --json body`.

## Human decision

Decide whether to approve a bounded investigation and presentation repair under C6/C15, or fold this evidence into 011-206's follow-up. Keep exit 3 while listing is unconfirmed. The file classes must explain the revision that their passing results cover and the listing limit. Acceptance evidence should cover edits and a branch switch during a named wait, a pending listing, a settled listing and a selected failure. Text, JSON and exit code must agree without weakening revision gates. Existing holds stand. This triage authorizes no implementation.
