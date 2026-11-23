# Issue 271: focused request waits for reconciliation

Date: 2026-11-23. Issue: https://github.com/hearsay-tools/squeal/issues/271.

## Fit and ownership

Inferred: passes the vision decision filter: reduce blocking and return timely,
revision-correct evidence through the harness-neutral core. Owner: spec 011
C2 (watcher and revisions), C4 (scheduler and result validity), C6 (status),
C9 (daemon lifecycle), C15 (named demand). Related: spec 019 D6 narrow run;
005 D2 wait wording. This triage changes no contract and authorizes no work.

## Reproduction verdict

Not reproduced, because the one-minute host load was 23.05 on 16 online CPUs.
The human explicitly required skipping live reproduction above CPU count.
No researcher or probe was started, and no test request or restart was made.

Verified by command: `getconf _NPROCESSORS_ONLN` returned `16`;
`cat /proc/loadavg` returned `23.05 23.09 24.40 22/1955 2082782`.
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version`
returned `0.1.606`. The incident reports Squeal **0.1.604**, not the session
runtime. These observations do not reproduce the incident or show a fix.

## Reported evidence, not independently reproduced

The agent-authored friction report describes a fresh Squawk worker, 14 edited
files, and a focused request that remained untaken during reconciliation of
5,683 paths. The exact reported command was:

```sh
squeal run tests packages/cezar/src/preview/dev-server.test.ts packages/cezar/src/lint/probe-release-port.test.ts scripts/release-smoke.test.mjs --wait 1000
```

The receipt said the deadline passed before scheduler acceptance and the
request stayed pending. Revision 6 had not listed the Vitest and node:test
files. At revision 9 the reported JSON had `testFilesListed: true`,
`refinedRevision: 1`, `runnerPartPending: true`, and an alive daemon.
These are different snapshots; neither establishes why reconciliation had
5,683 paths, whether they were edits, or which operation blocked acceptance.
A one-second timeout alone does not prove a scheduling defect. The report
also describes several minutes of late results. No restart was tried.

## Duplicate check

Read in repository documentation and GitHub reports: searched origin/main's
board for `#271`, `gh-271`, reconciliation, focused scheduling, `5683`,
`5,683`, and all three named test filenames. No existing #271 row or exact
symptom/file match was found. Open-issue checks included the `triaged` label:

```sh
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state open --search 'reconciliation in:body' --json number,title
gh issue view 245 --repo hearsay-tools/squeal --json state,title,body
gh issue view 235 --repo hearsay-tools/squeal --json body
gh issue view 87 --repo hearsay-tools/squeal --json body
```

Inferred: no exact open duplicate found. #245 concerns clearing a broad
affected queue before a local gate deadline; #235 concerns the automatic
quiet delay after a focused request; #87 concerns older runs blocking current
revision waits. Board gh-176 covers revision-zero startup acceptance and
gh-154 records earlier pending group requests. They overlap, but none proves
the same cause as this reconciliation-before-acceptance report. Do not merge
or reopen their work on this evidence alone.

## Human decision

Approve bounded diagnosis of request acceptance and reconciliation progress,
or defer until incident records or a quiet isolated reproduction are available.
Decide whether that diagnosis should join the #245 follow-up. Existing holds
stand; this row authorizes no implementation or dispatch.

Done when: selected known edited test files receive current results without
unrelated reconciliation blocking their request, or a bounded response names
the required dependency, progress and safe recovery action. Explain what the
path count includes. Preserve discovery/key validity, revision provenance,
unknown/pending states, resource policy and fairness. Verify with a fresh
worker and edits during reconciliation before claiming the defect fixed.
