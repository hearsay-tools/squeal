# Issue 73: stale estimates can delay a promoted wait

Date: 2026-10-21. Owner: spec 011, C4 step 5, C6 and C15.

## Fit

Inferred: passes the vision decision filter. It reduces avoidable blocking for relevant feedback while preserving provenance, uncertainty and host limits. The scheduling rule belongs to the core, across harnesses.

## Reproduction verdict

Not reproduced, because the host one-minute load was 27.62 across 24 online CPUs. The triage instruction requires skipping live reproduction above the CPU count. No researcher, throwaway probe, test run, restart or duplicate runner was started.

Verified by command: `cat /proc/loadavg` returned `27.62 24.46 27.98 42/4082 1548640`. `getconf _NPROCESSORS_ONLN` returned `24`. The checkout package version was `0.1.240`, read with `node -p 'require("./package.json").version'`; this session's installed Squeal CLI is 0.1.240. Neither version was used for a live reproduction.

Read in issue #73: the agent reported Squeal 0.1.238. Its exact command was:

```sh
node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.238/dist/cli/squeal.mjs status --wait 60000 packages/cezar/src/core/native-failure-control.test.ts
```

The issue reports a zero-second estimated remainder at 15:51:36 UTC and the requested file starting at 15:52:31 UTC on 2026-10-21. It reports a live daemon and continuing tests. A prior transform failure supplying a short estimate is a hypothesis, not an established cause. The command above is reported evidence, not a command executed in this triage.

## Contract and duplicates

Read in spec 011 C4 step 5: an eligible tier yields once per file and key when its largest last-known duration less elapsed time exceeds 30 seconds. Unknown durations count as zero. Inferred: that estimate rule alone does not impose an elapsed-time fallback for an underestimated tier. C6 and C15 own the wait and its pending explanation. This does not establish the cause of the reported incident.

Read in origin/main board after `git fetch origin`: searches for `#73`, promoted waits, yield, estimates and `native-failure` found no exact issue row. Related 011-51 (001-381), gh-63 and gh-69 shipped the estimate-based yield in 0.1.237. They do not cover the residual stale-short estimate request. Open #51 concerns queue priority and timeout wording; open #62 concerns duration measurement and may affect estimates, but has different acceptance criteria.

Commands used for the duplicate check: `git show origin/main:docs/board.md`, text searches over that output, `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels`, and `gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title`. No exact open duplicate was found, including among triaged issues. Closed #63 and #69 are prior work, not reasons to close this residual report.

## Human decision

Approve or decline a design for an elapsed-time fallback or estimate-confidence check, including the scheduling bound or actionable explanation when estimates fail. Preserve concurrency limits, coverage, once-per-key protection and honest pending results. Existing holds stand. The proposed gh-73 row authorizes no implementation.
