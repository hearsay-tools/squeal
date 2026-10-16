# Issue 20: setup failures under Squeal tmp paths

## Verdict and provenance

Not reproduced, because the one-minute load average was 57.73 on 24 online CPUs. Live reproduction was skipped under the triage load rule; no researcher or probes were dispatched. Checkout Squeal version: 0.1.203 (`package.json`); the active session plugin reports 0.1.199. The issue does not identify the incident version. Neither version was exercised for this report.

## Evidence

- **Read in issue:** [#20](https://github.com/hearsay-tools/squeal/issues/20), labelled `friction`, is agent-reported evidence. It reports `setup failed: ENOTEMPTY, Directory not empty: /tmp/squeal-1001/tmp/ebe319e88fb7c67b/cezar-e2e-new-task-A9IQei` at `packages/web/e2e/new-task.e2e.ts:88:17`; 17 of 18 recorded runs passed across four other worktrees. Its cited run is `.git/squeal/runs/5c60add7-5bf8-4fb1-84a4-54d6425db661` in the cezarion main checkout. That log was not inspected here. A concurrent writer causing the cleanup collision is the reporter's explanation, not a verified cause.
- **Read in specification:** 011 C5 requires agent-requested retries for causes outside keyed inputs and keeps FAIL counted until a pass. Its automatic first-failure rerun excludes slow files. C6 owns status/evidence, C9 owns the private tmp root. 013 V4 describes file setup errors; V8 distinguishes runner startup failures. The `setup failed` wording alone does not establish a global-setup failure.
- **Inferred:** the proposal fits vision filter 1, 2, 3 and 6 if bounded retry retains uncertainty and evidence. A tmp-root path and filesystem code alone do not prove an environmental cause; a test regression can also cause cleanup failure. Suppressing the known failure during retry needs an explicit policy decision and an honest pending state.

## Commands and observations (2026-10-17 triage)

```sh
git fetch origin
git show origin/main:docs/board.md
gh issue view 20 --repo hearsay-tools/squeal --json title,body,labels,url
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
cat package.json
```

Load output: `57.73 44.45 28.21 37/4015 2959109`; CPU output: `24`. No live reproduction commands were run.

Board searches used `git show origin/main:docs/board.md | rg -n` with `#20`, `gh-20`, `ENOTEMPTY`, `EBUSY`, `EEXIST`, `new-task`, `environmental`, `retry`, and `tmp`. No existing #20 row or matching cleanup-error retry row was found. The named cezarion test is outside this repository. Open issues #1 and #7/#8 concern store contention; #3/#16 concern missing build prerequisites. They are distinct. All open issues except #1 and #20 already carried `triaged` at inspection. Related board row 001-397 concerns explicitly retrying failed global setup, not automatic classification of a file setup error. The Later tmp-fixture cleanup item concerns leaked Squeal test directories, not this retry contract. No duplicate found.

## Human decision and done-when

Decide whether to authorize a narrow exception to 011 C5's agent-only retry/counting policy for setup filesystem errors under the verified Squeal tmp root, including slow files; define classification evidence, pending status, retry exhaustion and protection against masking real failures. Existing holds stand. No implementation is authorized.

If approved: the qualifying setup failure gets one automatic retry; it is absent from Known failures while pending and after a passing retry, but remains explicitly unvalidated while pending; a failed retry is reported; `why` retains the first error, classification reason and retry outcome. Regression coverage must include persistent errors, passing retry, paths outside the owned root and real failures that resemble environmental ones.
