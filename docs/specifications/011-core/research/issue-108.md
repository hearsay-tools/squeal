# Issue 108: busy stop-mark writes during start

Date: 2026-10-27. Issue: https://github.com/hearsay-tools/squeal/issues/108.

## Fit and owner

Inferred: passes the vision decision filter. A confirmed stop-mark outcome makes validation state more trustworthy and keeps uncertainty explicit across harnesses. Spec 011 owns this: C9 daemon lifecycle, C7 shared store, C13 error handling, and C6 status.

## Reproduction verdict

Not reproduced, because the one-minute host load was 39.64, above 24 logical CPUs. No researcher, live reproduction or probe was started. The load rule applies even to a small lock probe.

Verified by environment reads:

```sh
cat /proc/loadavg
# 39.64 43.07 42.31 46/4008 2094391
getconf _NPROCESSORS_ONLN
# 24
```

The issue reports Squeal 0.1.359 in Codex. This checkout and session use 0.1.361 (`package.json` and the session launcher version path). The original commands were `squeal status --json` then `squeal start`. The report records `could not clear the stop mark: database is locked`, daemon alive, and exit 0. These are reported observations, not an independent reproduction. The lock holder and the stored mark after the command remain unknown.

## Source evidence and duplicate check

Read in source code: `src/cli/start.ts`, `startCommand`, calls `clearStoppedMark` and prints its error, then continues daemon startup/liveness handling. Its normal success path returns 0. This supports the reported ambiguity but does not prove the original contention cause.

Read in source code: `src/cli/stopped-mark.ts` owns clearing the persistent stop mark. `withStore` uses a 2,000 ms busy timeout and one transaction, then returns the caught error without an outer retry. No product file was changed.

Read in repository and GitHub data: `git fetch origin`; `git show origin/main:docs/board.md` searched for `#108`, `stop.mark`, `start.ts`, and retry-write symptoms. No existing issue-108 row or exact matching row was found. `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` included the open `triaged` issues; none matches this write. Issue 109 concerns delayed heartbeat classification, not clearing the mark. Closed #1 / gh-1 covers daemon recovery. Closed #86 / gh-86 and done 011-212 cover retry-request writes. They provide related evidence, not an exact duplicate.

## Human decision

Decide whether to approve a bounded retry of the start stop-mark write, with an explicit unresolved-mark outcome and next action on exhaustion. The retry bound and command exit semantics need approval; daemon liveness alone cannot prove the write succeeded. Required evidence would hold a store write lock across start, test recovery and exhaustion, and inspect the stored mark and command result. Existing holds stand. This triage authorizes no implementation.
