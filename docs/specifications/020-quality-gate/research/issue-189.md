# Issue 189 triage: project coverage and per-file records

Date: 2026-11-11. Issue: https://github.com/hearsay-tools/squeal/issues/189.

## Fit and owner

**Inferred:** passes the vision decision filter: one run can reduce repeated validation while retaining project policy and evidence provenance. Spec 020 D13.1/D13.3/D13.6/D13.7 owns the gate evidence question; spec 018 D8/D10 owns the CI runtime and coverage compatibility contract. Project reports and thresholds must remain trustworthy.

## Reproduction

Not reproduced, because the one-minute load average was 33.74 on 24 CPUs. The human requires skipping live reproduction above CPU count. No researcher was dispatched and no probes or tests ran.

**Read in source code:** checkout package version is 0.1.440; this session's installed Squeal is 0.1.439. `src/runners/vitest/ci-runtime/coverage.cjs:55` checks `vitest.config?.coverage?.enabled === true` and returns `offCoverage("project-coverage", why)`. This confirms the intended yield branch, not an end-to-end reproduction or report parity.

Exact inspection commands:

```sh
git fetch origin
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
head -12 package.json
sed -n '46,63p' src/runners/vitest/ci-runtime/coverage.cjs
sed -n '210,227p' docs/specifications/020-quality-gate/spec.md
git show origin/main:docs/board.md | rg -n '#189|project.coverage|coverage.cjs|yield|project report'
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
```

## Duplicate verdict and existing decision

**Read in source code:** origin/main already has row 020-26 for #189, approved as research by the human on 2026-11-11 and marked running, with `research/issue-189-brief.md`. Update that row; do not add a second Triage row or reset its approval. The existing brief asks whether wrapping the project's provider can preserve its reports and thresholds before considering replacement.

No separate exact open issue duplicate was found, including issues labelled `triaged`. #190 concerns carrying coverage through shared results (018-35), not producing project coverage reports. It is related and is now closed, rather than an open duplicate.

## Decision and done-when

The human has approved research, not an implementation design. After that research, choose whether and how to support both outputs, including wrapping versus replacement, supported providers/reporters, report parity tolerance, omitted-record cases, threshold exit semantics, mode provenance and measured real-shard cost. Existing holds stand. This triage authorizes no implementation or extra dispatch.

The requested outcome is one `ci record` run with project coverage enabled producing both per-file parts and the project's coverage report in its configured directory and formats. Compare file sets and covered lines against the project's provider, including cases without Squeal records. Preserve threshold exit codes, name the mode in parts and help, and report cost on a real cezarion shard.
