# 019 Run triggers: status

Stage: research
Started: 2026-11-02

## Decisions so far

- 2026-11-02, the human, three items to research: "each runner can be configured to run: after each edit, stop only (including slow tests)"; "potentially add a configurable (?) checkpoint at commit"; "extending the timeout on Stop so that it could require all slow tests to be ran (unless that's already handled)".
- 2026-11-02, the coordinator (14c91259): wave 0 is three researchers in parallel, one per item, topics `runner-trigger`, `commit-checkpoint` and `stop-wait` in `research/README.md`, on the standing researcher model. Part of item 3 exists: `stop.requireSlowSuite` with `stop.slowWaitMs` (004 D7, D9) waits up to 600000 ms and then holds the agent once; `stop-wait` measures what that leaves out. The spec, if any, is written from the findings, for the human's review.
- 2026-11-02, the coordinator: wave 0 landed. `runner-trigger.md`: about half handled by `slow.include` with `slow.trigger: "idle"`; missing a per-group trigger (one key for the repository), and cheap tests marked slow take the load guard and shared slot; the primer still says "after each edit"; the unit should be the slow-marking group, not the runner. `commit-checkpoint.md`: no blocking hook (bypasses everywhere; tool hooks parse 0 of 11,412 real `git commit` calls; husky's `core.hooksPath` disables git hooks); a report on the committed tree from the daemon's `HEAD` move runs nothing new; the gate exists as `squeal run --all --wait` in a project's own hook. `stop-wait.md`: not handled; one bounded try (120 s default, 600 s cap), skipped for the rest of the turn once Squeal spoke at Stop, never starts an unqueued slow file; Claude Code accepted a 1900 s Stop hook; cezarion's whole slow tier takes 17 to 32 min; smallest change: Stop requests the slow tier as `run --slow` does, then a higher cap. Defect found, not yet a row: Codex SubagentStop never checks the slow tier, against 004 D7 (`stop-wait.md` C8). Next: the human's answers to the findings' open questions; no spec or build is authorized.

## Open questions

- Is "stop only" for a runner a new mode, or the slow tier (004) applied to a whole runner?
- Does a commit checkpoint block the commit, or only report on it?
- Can Stop wait for every slow file without a bound, in each harness?
