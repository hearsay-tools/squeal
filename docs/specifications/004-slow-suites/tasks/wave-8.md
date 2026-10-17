# 004 wave 8: a tier precondition

Approved by the human on 2026-10-17 (`docs/triage/2026-10-17-digest.md`, group E: precondition, skip, no build). Two steps; the second is dispatched only after the first.

## 004-65, step 1: the amendment (coordinator, docs)

Draft the D7 and D8 text: a per-tier precondition (`slow.precondition`: a file that must exist, or a command that must succeed, checked before the tier runs), and the one `skipped: <reason>` result an unmet precondition produces, which never reads as a pass or as full validation in status, the delivery or `run --slow --wait`'s verdict. No build step: goal 8 and non-goal 1 stand. Sources: `research/issue-3-preconditions.md` and its probe; issues #3 and #16. Stop: the human accepts the text (dated line in `status.md`).

## 004-65, step 2: the implementation (after step 1)

Use /worker. Shape: slice. Seam: the slow tier's run entry under `src/core/slow/`, before the tier is issued; first edit: evaluate the precondition and emit the skipped result. Owns: the precondition check, the policy key in `src/core/daemon/policy.ts`, the skipped-tier text in status and delivery, the README section, tests under `test/slow`, `test/policy`, `test/status`. Leave alone: the scheduler's fast tiers, 011's rows. Done when: the board row's regressions pass, suite green, version raised. Stop: ranking (gh-4) and the heartbeat wait (gh-12) are other rows.

## 004-66: a slow wait tells a stale heartbeat from a stopped daemon (after 011-01)

Use /worker. Shape: repair. Dispatched only after 011-01 has landed, since the lock that caused the lapse is its. Outcome: a requested slow wait never says no daemon while the daemon is alive. Read 004 D8, D9, 011 C9 and `research/issue-12.md` with `research/probes/issue-12/`. Seam: the daemon liveness check the slow waits use (`src/cli/status-wait-paths.ts` for named slow files; the `run --slow --wait` path); first edit: a stale heartbeat within a tolerance like the Stop wait's 10 s down bound, confirmed by a socket or pid check, keeps the wait going and says so. Then the stopped-daemon text and the no-verdict exit code of `run --slow --wait`. Owns: those wait paths and their tests under `test/cli` and `test/slow`. Leave alone: the daemon's heartbeat writer (011-01 and 001-435), the Stop wait. Done when: the row's three regressions pass, suite green, version raised.

## 004-67: a no-edit session is exempt from the slow-suite requirement at Stop (after 005-68)

Use /worker. Shape: slice. Dispatched after 005-68 lands: both edit `src/harness/shared/primer.ts` and the four skill copies. Outcome: a session that changed nothing is not held at Stop for slow files. Read 004 D7, D9, 005 D6, 011 C8 and `../../005-agent-adoption/research/issue-19.md`. Seam: `src/harness/shared/stop-slow.ts`, the waiting Stop entry: before it waits, compare the worktree's current revision with the revision recorded at the consumer's registration (`meta`, 011 C5); first edit: equal revisions return `null` within the 2 s budget. Then the primer sentence and the skill copies: the requirement is stated per policy value with the exemption. Owns: `src/harness/shared/stop-slow.ts`, the primer's slow-suite sentence, `plugins/*/skills/squeal` slow-suite text, tests under `test/harness` and the text tests. Leave alone: the slow tier's scheduling, `stop.slowWaitMs`, 004-65's precondition. Done when: the board row's regressions pass, the four copies agree, suite green, version raised. Stop: a task-forbids-tests rule is the agent's instruction, not Squeal's.

## 004-65 step 2, repair 1 (review `../reviews/wave-8.1.md` FAIL on d58e3d05)

Use /worker. Shape: repair, on this candidate branch. Outcome: B1 to B4 and S1 of `wave-8.1.md` closed, each with the reviewer's reproduction as a regression that fails on d58e3d05. Read the review whole, then `tasks/004-65/notes.md`, D7 and D8. Follow each finding's **Repair** paragraph; the coordinator's decisions where it leaves a choice:

- **B1:** a skipped file counts as not run at this revision with the skip's reason, never current, even when a stored result matches its key; the result stays as history and becomes current again only through a run or a met check at a later checkpoint. Status, delivery, `run --slow --wait`, `run --all` and Stop read the same state (`slow-skip.ts`, `state/slow.ts`, `state/slow-text.ts`).
- **B2:** an async command outcome is applied only when the revision and resolved rule it checked are still current under the scheduler lock; a superseded outcome is dropped and the work stays eligible, the newer checkpoint not abandoned. Latch-based regression, including a policy edit mid-command.
- **B3:** the fast-lane verdict of a skipped `run --all` covers every listed fast file, the already-current ones included (`src/cli/run-skipped.ts`); regression with a current fast failure outside the request, and a clean-current control.
- **B4:** policy-change requeue is decided per skipped ref, the group partitioned; mixed Vitest/node:test regression and the reverse override-to-global case.
- **S1:** the precondition command runs in its own process group, killed as a group at timeout and at daemon close, by the existing termination helpers (`src/core/daemon/terminate.ts`); a wrapper-spawns-child regression checking liveness.

Owns: `src/core/slow/precondition.ts`, `src/core/scheduler/slow-skip.ts`, `slow-tier.ts`, `src/core/state/slow*.ts`, `src/cli/run-skipped.ts`, the Stop/delivery readers it must align, their tests. Leave alone: `src/core/state/fingerprint.ts`, `derive.ts`, `shown-result.ts`, `delivery/delta.ts` (011-14's repair), `src/cli/named-file*.ts`, `src/core/scheduler/promotions.ts` (011-13). `KEY_FORMAT_VERSION` 11 re-pinned in place if guarded sources change. No version bump, no `npm run build`, no spec edit (the coordinator amends D8 if your notes say it must). Done when: the regressions pass, lint, typecheck, `squeal run --all --wait` green but for known failures. Commit on this branch.
