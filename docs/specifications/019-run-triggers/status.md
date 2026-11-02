# 019 Run triggers: status

Stage: research
Started: 2026-11-02

## Decisions so far

- 2026-11-02, the human, three items to research: "each runner can be configured to run: after each edit, stop only (including slow tests)"; "potentially add a configurable (?) checkpoint at commit"; "extending the timeout on Stop so that it could require all slow tests to be ran (unless that's already handled)".
- 2026-11-02, the coordinator (14c91259): wave 0 is three researchers in parallel, one per item, topics `runner-trigger`, `commit-checkpoint` and `stop-wait` in `research/README.md`, on the standing researcher model. Part of item 3 exists: `stop.requireSlowSuite` with `stop.slowWaitMs` (004 D7, D9) waits up to 600000 ms and then holds the agent once; `stop-wait` measures what that leaves out. The spec, if any, is written from the findings, for the human's review.

## Open questions

- Is "stop only" for a runner a new mode, or the slow tier (004) applied to a whole runner?
- Does a commit checkpoint block the commit, or only report on it?
- Can Stop wait for every slow file without a bound, in each harness?
