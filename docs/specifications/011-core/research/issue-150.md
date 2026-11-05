# Issue 150: read-only startup queues baseline work

Date: 2026-11-05. Source: https://github.com/hearsay-tools/squeal/issues/150.

## Reproduction verdict

Not reproduced, because one-minute load 47.72 exceeded 24 logical CPUs. Live reproduction was skipped under the triage load rule. No researcher or probe was started. No hold was changed.

## Evidence

- **Read in issue report:** Squeal 0.1.404, revision 0, dirty null, 12 files running and 356 queued without edits or an explicit test command. Host load ranged from 53.38 to 58.17 on 24 CPUs. The daemon averaged 0.217 CPU core over 68.43 seconds, excluding test children. Added workload does not prove this daemon caused saturation. Subagent registration does not prove a second daemon.
- **Observed session metadata:** this session is pinned to 0.1.404. Its revision-0 primer reports lookup-only baseline, no files queued, 13,174 current records, 1,457 loaded test files and one unknown file without checks. This incidental observation is not a controlled reproduction or evidence about the original worktree.
- **Read in specification:** 011 C4 preserves inherited results and queues no ordinary lookup-only misses, with an exception for held inherited failures needing local confirmation. C9 owns startup; C10 owns policy and capacity; C6 owns truthful status. Related 002 D2 owns Codex registration, and 001 D11 defines startup policy. The original effective policy and reason for admission remain unknown.

## Exact intake commands

```sh
git fetch origin
gh issue view 150 --repo hearsay-tools/squeal --json state,title,body,labels,url
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
```

Load output: `47.72 51.39 55.28 53/3493 555499`. CPU output: `24`. Gate sampled during this triage on 2026-11-05. No live reproduction commands ran. The reporter used the installed launcher with `squeal status --json`; its projected output is retained in the issue.

## Fit and duplicates

**Inferred:** passes the vision decision filter through more relevant feedback, less measurement noise, retained provenance and project policy. Owner: 011 C4/C6/C9/C10. Codex registration remains an adapter boundary.

Checked origin/main board for #150, gh-150, baseline, read-only and startup. The issue names no product source file. Checked open issues and their triaged labels. No existing #150 row or exact open duplicate. Closed #124 / 011-278 documents pre-start child-root hold ordering; #19 concerns completion instructions requesting slow runs; #24 concerns explanations. Open #146 and #139 concern throughput and blocker reporting, not unchanged-session startup admission.

## Human decision

Investigate the effective startup policy and admission cause first, or approve a distinct read-only mode with explicit discovery and execution exceptions. Preserve inherited evidence and honest unknowns. Host-wide admission is separate scope unless approved. Existing holds stand; this triage authorizes no implementation.
