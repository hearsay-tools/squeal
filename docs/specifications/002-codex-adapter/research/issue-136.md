# Issue 136: expected test-first failure denies the fix edit

Date: 2026-11-02. Issue: https://github.com/hearsay-tools/squeal/issues/136

## Verdict

Not reproduced, because the one-minute host load was 42.00 on 24 CPUs. The human requires skipping live reproduction above the CPU count. No researcher was dispatched and no probes ran.

## Evidence and versions

- Issue report (not independently verified): Squeal 0.1.390 under Codex denied one `apply_patch` to `packages/cezar/src/delegation/provision.ts` after an expected PASS -> FAIL in `packages/cezar/src/delegation/provision.test.ts`. The identical patch succeeded on retry; FAIL -> PASS followed at revision 3. The report estimates about 20 seconds lost.
- Issue report: disposable-worktree command `npm test -- --passWithNoTests=false packages/cezar/src/delegation/provision.test.ts -t 'deliberate effort selection|distinct purposes'` gave 2 failed and 13 skipped before the fix, then 2 passed and 13 skipped. This is the reporter's Cezar command, not a command run in Squeal during intake.
- Read in checkout: `package.json` version 0.1.391. Session runtime supplied by Squeal: 0.1.390. Neither was exercised for reproduction.
- Verified by host inspection: `/proc/loadavg` gave `42.00 53.16 50.80`; `getconf _NPROCESSORS_ONLN` gave `24`.

Exact intake commands relevant to this verdict (no live reproduction commands):

```sh
git fetch origin
gh issue view 136 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md > /tmp/issue136-board
rg -n '#136|test.first|expected.failure|provision\.ts|provision\.test|onRegression|## Triage' /tmp/issue136-board
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title --jq '.[] | "\(.number) \(.title)"'
```

## Fit and owner

Read in spec: 002 goal 3 and D3 require the next `apply_patch` after an undelivered regression to be denied once. Original D8 (Policy) ties this to `interrupt.onRegression`. Spec 011 C8/C10 owns the shared hook contract and policy. The reported behavior fits the current contract; this is a proposed policy extension, not proof of a contract violation.

Inferred: the request passes the vision filter by reducing unnecessary blocking while preserving failure evidence, revision provenance and unrelated regression protection. Spec 002 owns it, with 011 C8/C10 as shared seams. A named-test/revision declaration is a proposed design, not approved behavior.

## Duplicate verdict and human decision

Read in origin/main's board and open issues: no #136 row or named Cezar file match. Existing Triage row gh-71 and open, triaged #71 cover the same denied repair edit and identical retry. Update gh-71 with this report rather than create a second row. Other open issues, including triaged issues, do not add a closer match.

The gh-71 hold remains: grouping shipped in 0.1.262, but changing deny-once waits for evidence that retry still costs. This report supplies later evidence at 0.1.390; it does not itself remove the hold. The human decides whether to revisit that contract and approve a scoped expected-failure declaration, or keep the current retry. If approved, expected failures must remain visible, unrelated regressions must still interrupt, and scope must expire with its named test/revision. Completion policy remains unchanged. No implementation or spec amendment is authorized by this triage.
