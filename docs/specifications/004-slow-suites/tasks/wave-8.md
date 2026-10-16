# 004 wave 8: a tier precondition

Approved by the human on 2026-10-17 (`docs/triage/2026-10-17-digest.md`, group E: precondition, skip, no build). Two steps; the second is dispatched only after the first.

## 004-65, step 1: the amendment (coordinator, docs)

Draft the D7 and D8 text: a per-tier precondition (`slow.precondition`: a file that must exist, or a command that must succeed, checked before the tier runs), and the one `skipped: <reason>` result an unmet precondition produces, which never reads as a pass or as full validation in status, the delivery or `run --slow --wait`'s verdict. No build step: goal 8 and non-goal 1 stand. Sources: `research/issue-3-preconditions.md` and its probe; issues #3 and #16. Stop: the human accepts the text (dated line in `status.md`).

## 004-65, step 2: the implementation (after step 1)

Use /worker. Shape: slice. Seam: the slow tier's run entry under `src/core/slow/`, before the tier is issued; first edit: evaluate the precondition and emit the skipped result. Owns: the precondition check, the policy key in `src/core/daemon/policy.ts`, the skipped-tier text in status and delivery, the README section, tests under `test/slow`, `test/policy`, `test/status`. Leave alone: the scheduler's fast tiers, 011's rows. Done when: the board row's regressions pass, suite green, version raised. Stop: ranking (gh-4) and the heartbeat wait (gh-12) are other rows.
