# Issue 135: missing CRAP while coverage waits

## Verdict

Not reproduced, because the one-minute host load was 37.66 on 24 CPUs. The triage rule requires skipping live reproduction above the CPU count. No researcher or probe was started. This is documentation-only triage, not a confirmed product defect.

## Evidence

- **Read in issue:** [#135](https://github.com/hearsay-tools/squeal/issues/135), open at intake, reports Squeal 0.1.390 under Claude Code/Cezar. After `pnpm add`, revision 1 queued 1,182 test files. About 25 minutes later, nine changed source files had complexity but no `crap` field. The affected tests were reportedly current and passing; status reported 1,210 files awaiting test runs and one awaiting coverage records. Original store, exact JSON and loader sets were not supplied, so their relationship is unverified.
- **Read in repository:** checkout `package.json` is 0.1.390. Spec 015 D6/D8/D9 owns coverage collection, function details and incomplete evidence. D9 requires every loader's current record and holds sources pending while a test closure is unknown. Passing affected tests alone therefore do not prove complete function coverage. Spec 011 C4/C6/C15 owns scheduling, status and named demand.
- **Read in source code:** `src/cli/code-crap-reason.ts` adds `crap.reason` only to an existing unknown CRAP state. `src/cli/code-coverage.ts` omits the field when `m.crap` is undefined. This is a possible output gap beyond closed #129 / row 015-101, not proof of the reported cause. Do not infer zero coverage or a measured CRAP from an absent field.

## Commands and results

Intake commands, not reproduction commands:

```sh
git fetch origin
gh issue view 135 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:docs/board.md | rg -n -i '#135|gh-135|queued|coverage.*pending|coverage.*wait|run.ts'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

Load output: `37.66 42.94 37.31 31/4170 2832572`; CPU count: `24`. No install, coverage run, test run or daemon restart was attempted.

Reporter commands (not run here):

```sh
pnpm add
squeal code packages/cezar/src/lint/run.ts --json
squeal status
```

The package argument to `pnpm add` and the other eight file paths are absent from the report.

## Fit, duplicates and decision

**Inferred:** passes the vision filter: clearer incomplete evidence improves trust, and focused coverage demand could reduce blocking while preserving provenance and project resource policy.

No existing #135 row or exact symptom/file match was found on origin/main. The open-issue inventory, including triaged issues, has no exact duplicate. Closed #129 / done 015-101 explains unknown CRAP beside measured coverage; it does not establish reasons for absent CRAP fields or source-file coverage priority. Open #110/#127 concern test scheduling priority; they are related constraints, not duplicate coverage requests.

The human must decide whether to approve explicit per-function coverage state/reason plus a bounded source-file coverage wait, or approve explanation only and retain current scheduling. Any priority design must use 011 C15's demand policy and preserve fairness, resource gates and D9's complete-loader evidence rule. Queue position must come from recorded facts or remain unknown. Existing holds stand. No implementation is authorized.
