# Issue 226: failures also present at the base

## Verdict and fit

Not reproduced, because the one-minute host load was 87.09 on 24 CPUs at 2026-11-15 22:41 UTC. The triage rule requires skipping live reproduction above CPU count. No researcher, probe or test run was started.

[inferred] The request passes the vision filter: base-failure attribution can reduce unnecessary blocking and improve provenance across harnesses. Allowing an inherited failure to stop blocking is a policy change, not an established safe consequence of attribution. Owner: spec 020 D3 (collection), D5 (completeness and verdict), D6 (base policy), D7 (report), D11.7 (reuse), D17.3 (storage).

## Reported evidence

[read in official docs: issue report, not independently verified] [#226](https://github.com/hearsay-tools/squeal/issues/226) reports installed Squeal 0.1.516, Squawk head `a5b6b0cf6`, and hearsay-tools/squawk#3663. Five changed files selected a pre-existing PTY test in the changed `packages/cezar/src/session-signal-cli.test.ts`. All 33 changed functions read incomplete. The reporter says the same test failed after restoring origin/main's product file, with ECONNREFUSED during a health poll; CI passed on the head. Restoring one product file is not proof of a clean merge-base execution with equivalent dependencies and environment.

Reported command:

```sh
squeal code --base origin/main --json > report.json
```

Reported result: exit 3, verdict incomplete, 33 incomplete functions. The failure ran twice at load 92.85/24 CPUs; the second failure remained. The run log was not retained because the database was locked. Exact head/base test commands and a clean base-run artifact were not supplied. Neither the host-specific cause nor the base equivalence is verified here.

## Contract and duplicates

[read in official docs: repository spec] D5 requires no selected failure for completeness, blocks every changed function on a selected failure, and keeps measured rows. D7 already reports failed tests and loader attribution. Thus measured CC/coverage/CRAP beside incomplete state is consistent with the current contract. Base attribution and an exemption from failure blocking need a human decision.

[read in official docs: board and issue inventory] origin/main has no #226 row, no row naming session-signal-cli, and no exact inherited-failure proposal. Open issues, including triaged issues, have no exact duplicate. Closed #210 and done rows 020-53/54 cover global failure attribution and one load retry, with D5 blocking preserved. Open #216/#222/#223 concern load, pending retries and stored-failure recovery. #224 covers the separate lost-result contention symptom. These overlap but do not settle base-failure classification.

## Intake commands and limits

Commands executed for this triage (no live reproduction):

```sh
git fetch origin
gh issue view 226 --repo hearsay-tools/squeal --json state,title,body,url,labels
git show origin/main:docs/board.md
uptime
getconf _NPROCESSORS_ONLN
gh issue list --repo hearsay-tools/squeal --state open --limit 300 --json number,title,labels
```

The issue is open. Reported and session runtime version: 0.1.516. No CLI reproduction was executed. Board searches covered #226, the title symptom, session-signal-cli, inherited failure and base failures. Main CI's latest three listed runs passed at intake.

## Human decision

Approve bounded base-comparison research and choose diagnostics only versus a policy that can exempt verified inherited failures, or defer. Any future design must define clean merge-base execution, test identity, environment/input equivalence, a bounded run budget, missing-base-test and flaky outcomes, and independent regression controls. Unknown base evidence must remain unknown. Decide function completeness separately from the overall gate verdict; a base failure alone must not silently establish a pass. Existing holds stand. No implementation is authorized.
