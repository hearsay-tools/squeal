# Issue 258: obsolete observed inputs keep selecting tests

Date: 2026-11-21. Source: [#258](https://github.com/hearsay-tools/squeal/issues/258), an agent-reported `friction` issue.

## Verdict

Not reproduced, because the one-minute host load was 18.36 on 16 online CPUs. The human explicitly requires skipping live reproduction above the CPU count. No researcher, probe or test run was started. The reported 437 and 1,299 selected files are issue evidence, not measurements verified here.

Version: this checkout reports Squeal 0.1.580 (`package.json`). The issue records no incident version or revision; it names 0.1.580 as current when filed.

## Evidence and ownership

- Read in specification: 011 C3 defines `observed.<project>` as a shared per-project map, merged across worktrees and never pruned: a disappeared read over-runs rather than misses. The symptom is consistent with this explicit rule; it is not yet proof of the incident's cause.
- Read in specification: C4 incorporates newly observed paths before stability checks and storage under the resulting key. C7 owns shared results and provenance; C12 owns runtime recording; C6 exposes source-path selections. These sections would need consideration in any approved change.
- Inferred: replacing the shared union with one run's reads could lose another branch's inputs, conditional reads or reads absent from an incomplete run. A design must define complete-run evidence and its scope before removal. An N-run age limit alone does not establish safety.
- Fit: more precise affected selection reduces validation cost and noise across harnesses. It must retain honest uncertainty, provenance and project policy.

## Commands and duplicate search

Read-only commands used for intake and the reproduction gate:

```sh
git fetch origin
gh issue view 258 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
git show origin/main:docs/board.md
gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels
```

The gate returned `18.36 22.51 25.65` for the load averages and `16` CPUs. No reproduction commands were run. Board searches covered `#258`, `agent-runner.ts`, `runner-registry.ts`, `add-only`, removed runtime dependencies, and observed-set removal or shrinking. No existing row tracks this symptom. The named files belong to the reporting project, not this repository. Open-issue titles and labels, including `triaged`, were checked: #254 concerns export completeness, #249 package manifest fanout, and #80 adding new module dependencies. None is an exact duplicate. Completed row 018-07 describes add-only import merging, not removal after fresh runs.

## Human decision

Keep the conservative union, or approve a bounded design for retiring obsolete observed inputs after suitable complete-run evidence. Define cross-worktree and conditional-read safety before implementation. Existing holds stand. This triage authorizes no code or spec change.
