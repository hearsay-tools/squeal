# Issue 62: file-level duration understates run time

Triage date: 2026-10-21. Owner: 013 V4 (Vitest results), related 011 C5 (stored results), C6 (why duration statistics), C7 (result storage) and C14 (RunReport). No implementation is authorized. Existing holds stand.

## Fit and evidence

**Inferred:** this passes the vision decision filter. Accurate file duration makes validation evidence more trustworthy across harnesses. It supports pull-state queries and policy decisions without adding routine notifications.

**Read in issue #62:** the report names Squeal 0.1.233, Vitest 4 and project `server`. The file-level check for `packages/cezar/src/core/harness-codex-parity.test.ts` records 3,496.5 ms at revision 9 and 3,256.0 ms at revision 5. The reported run log has 109 PASS lines totalling 108,788 ms and ends with `end: completed, 112541 ms`. A separate manual JSON-reporter run measured about 129 s at load 23–49. The report also compares 32,042 ms with 237 s for `harness-claude-parity.test.ts`. These are issue evidence, not measurements made by this triage. A whole-run log total and a separate run do not by themselves establish exact per-module boundaries.

## Reproduction verdict

**Not reproduced, because** the one-minute host load was **38.71**, above **24 online CPUs**. The user requires live reproduction to be skipped in this condition. No researcher, probe, test run or incident replay was dispatched. Local package version is **0.1.233**. Source baseline: `24c242f35c25bd16817e2f493d88ca69eae2cb90`.

Exact inspection commands:

```sh
git fetch origin
gh issue view 62 --repo hearsay-tools/squeal --json state,title,body,labels,url
uptime
getconf _NPROCESSORS_ONLN
node -p 'require("./package.json").version'
git show origin/main:docs/board.md | rg -n -i '#62|durationMs|file.level.*duration|harness-codex-parity|harness-claude-parity|vitest.log|wall.time'
gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels
gh issue list --repo hearsay-tools/squeal --state all --label triaged --limit 100 --json number,title
```

The issue's reported query was:

```sh
squeal why "[server] packages/cezar/src/core/harness-codex-parity.test.ts (file-level)" --json
```

It was not run here. The issue does not supply the full manual Vitest command, so none is invented.

## Duplicate verdict and human decision

**Read in origin/main board and GitHub issue lists:** no existing #62 row or exact duplicate was found. Proposed gh-55 concerns query latency, not the measured duration. Open #43 concerns recovery after the 600 s cap, not file-level time accounting. Done 001-366 concerns scheduling a backlog from file-time estimates, not this duration defect. The open-issue list and all issues bearing `triaged` contain no matching timing report. The issue currently has no `friction` label; it is not classified here as agent-reported friction.

The human must decide whether to approve a bounded correction to file-level wall-time accounting and its timing boundaries. A later implementation needs regression evidence that includes collection/setup and test execution as approved, distinguishes per-file wall time from a multi-file run total, and preserves failure and timeout semantics. The issue's done line asks that `squeal why` and the stored file-level `durationMs` match the file run log within a few seconds for a roughly 100 s file, and that `durations.minMs`, `medianMs`, `p95Ms` and `maxMs` use the same file-level value. Collection time, if retained, needs a separate field. This triage changes no timing contract.
