# 004 wave 8: a tier precondition

Approved by the human on 2026-10-17 (`docs/triage/2026-10-17-digest.md`, group E: precondition, skip, no build). Two steps; the second is dispatched only after the first.

## 004-65, step 1: the amendment (coordinator, docs)

Draft the D7 and D8 text: a per-tier precondition (`slow.precondition`: a file that must exist, or a command that must succeed, checked before the tier runs), and the one `skipped: <reason>` result an unmet precondition produces, which never reads as a pass or as full validation in status, the delivery or `run --slow --wait`'s verdict. No build step: goal 8 and non-goal 1 stand. Sources: `research/issue-3-preconditions.md` and its probe; issues #3 and #16. Stop: the human accepts the text (dated line in `status.md`).

## 004-65, step 2: the implementation (after step 1)

Use /worker. Shape: slice. Seam: the slow tier's run entry under `src/core/slow/`, before the tier is issued; first edit: evaluate the precondition and emit the skipped result. Owns: the precondition check, the policy key in `src/core/daemon/policy.ts`, the skipped-tier text in status and delivery, the README section, tests under `test/slow`, `test/policy`, `test/status`. Leave alone: the scheduler's fast tiers, 011's rows. Done when: the board row's regressions pass, suite green, version raised. Stop: ranking (gh-4) and the heartbeat wait (gh-12) are other rows.

## 004-66: a slow wait tells a stale heartbeat from a stopped daemon (after 011-01)

Use /worker. Shape: repair. Dispatched only after 011-01 has landed, since the lock that caused the lapse is its. Outcome: a requested slow wait never says no daemon while the daemon is alive. Read 004 D8, D9, 011 C9 and `research/issue-12.md` with `research/probes/issue-12/`. Seam: the daemon liveness check the slow waits use (`src/cli/status-wait-paths.ts` for named slow files; the `run --slow --wait` path); first edit: a stale heartbeat within a tolerance like the Stop wait's 10 s down bound, confirmed by a socket or pid check, keeps the wait going and says so. Then the stopped-daemon text and the no-verdict exit code of `run --slow --wait`. Owns: those wait paths and their tests under `test/cli` and `test/slow`. Leave alone: the daemon's heartbeat writer (011-01 and 001-435), the Stop wait. Done when: the row's three regressions pass, suite green, version raised.
