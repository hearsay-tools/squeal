# 004-65 step 1: the D7 and D8 amendment, for the human's review

Board row 004-65 (gh-3, issue #3; issue #16 the same defect). Digest group E, approved by the human 2026-10-17: a precondition, a skip, no build. Sources: `../../research/issue-3-preconditions.md` and its probe. Drafted by the coordinator, 2026-10-17. Nothing here is in `spec.md` until the human accepts it; on acceptance the text below replaces the marked sentences, a dated line goes into `status.md`, and step 2 is dispatched.

## Why

A slow tier that tests a build output runs against nothing when the output is missing: one missing `dist/` became 4 first-seen FAILs in 4 shapes in the probe and 9 in the issue, stored as `current`, closing a full-suite checkpoint, while the `Slow tier:` line said "current against dist/**". Squeal already knows before the run (D5's no-artifact note fires only in that case) and runs anyway. Goal 8 says the slow tier "runs against what is on disk and says so"; today it does not say so.

## D7, added after the `stop.slowWaitMs` sentence

> `slow.precondition` (default none) names what the slow tier needs on disk before it runs: `{"exists": [<path or glob>, ...]}`, each of which must match at least one file in the worktree, and optionally `{"command": [<argv>...], "timeoutMs": 10000}`, run without a shell in the worktree root at the slow tier's priority (D2) and met on exit 0. A `nodeTest[]` project marked `slow` may carry its own `precondition` of the same shape, which replaces `slow.precondition` for that project's files. Squeal checks the precondition when a slow tier is about to take the slot, never at the fast tiers, and never builds, installs or repairs anything to meet it (goal 8, the first non-goal). A command precondition is code Squeal runs beside the runner, so it is declared as visibly as `nodeTest[].argv` and listed by `squeal setup --check` (vision principle 8). With no precondition declared the slow tier runs as before.

## D8, added after the sentence on "not run at this revision"

> When a slow tier's precondition is unmet, its files are skipped: each is "not run at this revision" with one reason, `skipped: <reason>` (`dist/index.js matches no file (slow.precondition.exists)`; `node scripts/check-dist.mjs exited 1 (slow.precondition.command)`), and no result is stored, so a skip never reads as a pass, a failure or a current file. The `Slow tier:` line names the reason in place of its state and says Squeal runs the tier once the precondition holds; a delivery carries it once, when the tier's state changes to skipped, never per file (principle 1). The precondition is checked again whenever the slow tier is next eligible: at every revision for a command, and at a revision touching a path the `exists` globs select. A precondition that becomes met runs the tier at that checkpoint. A skip replaces D5's no-artifact note for the files it covers. `squeal run --slow --wait` gives no verdict for a skipped tier: it prints the reason and exits 3, never 0. A `run --all` checkpoint with a skipped slow lane is not a full suite: its verdict names the fast lane's result and the skip, exiting 1 on known failures and otherwise 3. With `stop.requireSlowSuite` on, Stop does not wait out `stop.slowWaitMs` for a skipped tier (nothing will run it): it holds the agent once naming the reason, and SubagentStop blocks naming it (D9).

## What this does not do

- No build step, and no "run the build for me" key: the issue's second half stays a non-goal.
- Presence is not freshness: an old `dist/` meets `exists`. D8's "sources changed since" still flags it; a command precondition can check more if the project wants.
- No precondition derived from `inputs` that match nothing. D5's note could later say "declare `slow.precondition`"; that wording is step 2's choice, not a behaviour.

## Questions for the human

1. **Exit codes.** `run --slow --wait` on a skipped tier exits 3 (no verdict), and a `run --all` with a skipped slow lane exits 3 when the fast lane is clean. Proposed as above; the alternative is exit 0 with the skip printed, which an agent can read as a pass.
2. **Command preconditions.** Proposed: allowed, argv only, with a timeout. The alternative is `exists` only, which covers both known cases (issue #3, cezarion's `dist/`) and runs nothing extra.
3. **Per-project override.** Proposed: `nodeTest[].precondition` beside `slow.precondition`, because two slow projects can test different artifacts. The alternative is one key for the whole tier.
