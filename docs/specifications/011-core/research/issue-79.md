# Issue 79: named queue priority

## Verdict

Not reproduced, because the host one-minute load was 68.44 on 24 CPUs. The triage rule requires skipping live reproduction above the CPU count. No researcher, test runner or throwaway probe was started.

## Evidence

- Read in issue: [#79](https://github.com/hearsay-tools/squeal/issues/79) is open and carries `friction`, an agent report. It reports 38–40 of 41 parity files pending for over 30 minutes behind about 537 same-tier files in cezarion#1425. Reported host load was 44–77 on 24 CPUs. These timings were not independently verified.
- Read in package metadata: checkout Squeal version is 0.1.276. The session plugin is also 0.1.276. The issue does not name the incident Squeal version.
- Verified by host inspection: `cat /proc/loadavg` returned `68.44 54.82 51.45 79/4430 720138`; `getconf _NPROCESSORS_ONLN` returned `24`.
- Read in spec: 011 C4 and C15 already put promoted named files ahead of queued work. C6/C15 govern status and honest promotion reasons. Related 005 D2 defines the named wait. The issue asks to leave a running tier alone; existing C4 has a bounded yield rule, so any change to that contract needs a human decision. No spec is changed here.

## Exact commands

Intake and duplicate checks used:

```sh
git fetch origin
gh issue view 79 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md | rg -n -i '#79|gh-79|queue|priority|status --wait|#78|#64|triage|hold|standing models'
git show origin/main:docs/board.md | rg -i 'run.ts|parity.test|no command runs it sooner|front of the queue'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
gh issue view 51 --repo hearsay-tools/squeal --json state,title
```

Reported command, not run here:

```sh
squeal status --wait 60000 packages/cezar/src/core/*-parity.test.ts packages/cezar/src/workflows/*-parity.test.ts
```

## Duplicate verdict and fit

Read in origin/main board: gh-51 is the same symptom and acceptance contract, marked shipped through 011-51, 011-54 and 011-63 in 0.1.242. This triage updates that existing row as gh-79, retains gh-51 as its historical key and keeps its shipped history. There was no #79 row. No open issue, including those labelled `triaged`, duplicates this request. Open #64 covers check selection within a file, open #78 slow-file execution, and closed #4 slow ranking. Related closed gh-69 covers a running tier.

Inferred: this is a reported recurrence of an existing contract, not evidence that priority has never existed. A current-version regression is unverified. Faster relevant feedback with less duplicate validation passes the vision decision filter. Owner: 011-core C4/C6/C15; related 005 D2.

The human must decide whether to approve bounded current-version investigation under the existing contract or request a changed command contract. Existing holds stand. This documentation authorizes no implementation.
