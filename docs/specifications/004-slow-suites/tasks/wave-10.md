# 004 wave 10: after the triage round of 2026-10-18

## 004-71 the quiet `status --wait` line follows the slow-suite policy

Use /worker. Shape: slice. Outcome: with `stop.requireSlowSuite` off, the quiet `status --wait` line says the slow files not current are not required before the agent finishes; on, it is unchanged. Read D8's amendment of 2026-10-18 (gh-35), D9, `research/issue-35.md` (its reproduction). Seam: `src/cli/status-wait-lines.ts:141`; first edit: pass the policy to that clause. Owns: that file, its readers in `src/cli/status-wait*.ts`, their tests. Leave alone: `src/core/state/slow-text.ts`, the primer, Stop. Done when: both policies' lines over the issue's docs-only sequence, plain and JSON where the line appears; lint, typecheck, `squeal run --all --wait` green but for known failures; version raised; no `npm run build`.

## 004-70 a rolled-back skip transaction restores queue order and promotions exactly

Brief written once 011-17 lands (both change `src/core/scheduler/queue.ts`).
