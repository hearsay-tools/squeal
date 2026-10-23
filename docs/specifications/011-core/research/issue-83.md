# Issue 83: named test outside coverage

Date: 2026-10-23. Source: [issue #83](https://github.com/hearsay-tools/squeal/issues/83), agent-reported friction.

## Fit and owner

Inferred: passes the vision decision filter. Explicit coverage limits preserve uncertainty and prevent a reader test pass from implying that an unexecuted test passed. Spec 011 owns status and selection semantics (C6, C15); 005 D2 owns related agent-facing guidance. No spec amendment or implementation is authorized by triage. Existing holds stand.

## Reproduction verdict

Not reproduced, because the one-minute host load was 68.08, above 24 CPUs. No researcher, live reproduction, test run or probe was started. The incident reports Squeal 0.1.277. The installed session skill is 0.1.278 and origin/main package.json reports 0.1.278; neither establishes reproduction on that version.

Exact intake commands and observed output:

```sh
uptime
# 20:19:42 up 9 days, 9:08, 6 users, load average: 68.08, 65.64, 68.83
getconf _NPROCESSORS_ONLN
# 24
gh issue view 83 --repo hearsay-tools/squeal --json state,title,body,labels,url
# OPEN; enhancement, friction, needs-triage, area-core
```

Reported by the issue, not independently verified: in cezarion, this command selects mock-source-boundary.test.ts and pid-file.testkit.test.ts, which read the named E2E file, without saying that the E2E file itself did not run:

```sh
squeal status packages/cezar/test/e2e/task-cli.test.ts
```

The issue reports the focused built CLI E2E passed when run manually. Its exact manual command is not supplied. This is a coverage-reporting ambiguity, not evidence of a failing product test.

## Duplicate verdict

Read in issue metadata and board: no existing #83 / gh-83 row or exact open duplicate, including issues labelled triaged. Searched origin/main docs/board.md for #83, gh-83, outside coverage, reader tests, task-cli, mock-source and pid-file, and reviewed coverage/named-test/unmatched-path rows. Checked open issues and the triaged subset with gh issue list. Issue #84 concerns current validity versus verdict in JSON; #56 concerns missing child-process inputs; #64 concerns focused checks; #82 concerns refresh-and-wait. Those overlap with status or selection, but do not request a distinction between an uncovered named test and passing reader tests.

## Human decision and done-when

Decide whether to approve an explicit outside-coverage indication for a named test even when reader tests are selected. Keep useful reader selection and identify its results separately. A regression should request an excluded test file read by passing covered tests and show that the named test did not run, in human and structured status, without implying its pass. An ordinary source path must still select its readers. This row proposes work only.

Verification: documentation-only change; no product, spec, status or skill edits. No tests run because the live reproduction was skipped under the load rule.
