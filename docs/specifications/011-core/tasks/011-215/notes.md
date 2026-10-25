# 011-215 notes: status-only liveness and hold news at Stop

Worker 730455f8, wave 42 W2, 2026-10-25. Row 011-215 (gh-93), digest `docs/triage/2026-10-25-digest.md` group C, `002-codex-adapter/research/issue-93.md`.

## 1. The rule as built

Source: the row's condition, "a liveness or hold change with no test transition, no unmet gate and no action is not news" at Stop. "No action" is read as below; the hold reading is the coordinator's (04a258b0, reply of 2026-10-25 to request 7dcd88c2).

At Stop (`onToolBoundary(..., { stop: true })`), with no test transition in the delta, a liveness or hold change is told only when one of them names an action. Else neither is told: the told slots (`livenessTold`, `holdTold`) keep their old values, so the next PostToolUse, PostToolBatch or UserPromptSubmit finds the same change and tells it once. With a transition, or with one change that names an action, the Stop speaks and tells every change, as before.

| Change at Stop | News on its own | Why |
|---|---|---|
| daemon down, no stopping mark (stale heartbeat, died, never heartbeat) | yes | no successor |
| daemon stopped by request (`squeal stop`) | yes | no successor; the text names `squeal start` |
| daemon stopping with no handoff claim (no `to`) | yes | no successor named |
| handover to a named successor, within its bound | no | names no action; the gh-93 case |
| handover or stop past its bound (`overdue`) | yes | names `squeal start` (`test/status/stopping.test.ts:132-135`) |
| a daemon validating again (with or without a late change feed) | no | names no action |
| a handoff that ended short (row 011-140) | yes | names `squeal start` of the claimed version |
| a merge hold starts | yes | names an action: resolve the paths and `git add` them, or abort; no test runs until then |
| a command hold (`squeal hold`) starts | no | the agent started it |
| any hold ends | no | names no action |

A gate the Stop cannot meet still blocks. Its block text is `statusText` (the full header, which says the handover), since the delivery returned nothing; the change's title then goes out at the next boundary. That is one repeat of the state sentence, accepted as the cost of keeping `stop.ts` unchanged.

## 2. Seam map

- `src/core/delivery/stop-news.ts`: `actsAtStop` (liveness), `holdActsAtStop` (holds), `toldAtStop` (the filter `deliver` calls).
- `src/core/delivery/delivery.ts` `deliver`: `toldAtStop` sits between `livenessChange`/`holdsChange` and `tellLiveness`/`tellHolds`. `tests` then counts only what is told, so code changes at Stop (015 D6, D7) also wait when the only other news waited.
- `src/harness/shared/stop.ts` `newsText` is the only caller with `stop: true`; both adapters (`src/harness/claude-code/hooks/stop.ts`, `src/harness/codex/handlers.ts`) and SubagentStop go through it. No change there.
- A silent Stop calls `endTurn`; the waiter (`waitForDelta`, idle) never reads liveness, so an idle agent hears the change at its next prompt.

## 3. Tests

- `test/harness/stop-liveness-news.test.ts`: both adapters from recorded inputs: the five done-when cases, a short handoff, a merge hold, a command hold, a handover beside a transition.
- `test/harness/stop-hold.test.ts`: B2 kept for the merge hold; a command hold at Stop waits for the next PostToolBatch.
- `test/delivery/hold-changes.test.ts`: a command hold's start and end at Stop wait for the next boundary.
- `test/delivery/stop-news.test.ts`: the table above for `actsAtStop` and `holdActsAtStop`.

## 4. Not done here

- Spec text: 002 D3 ("news at Stop always costs a continuation") and 011 C8 (011-73's "a hold change at Stop is news, as a liveness change is") need the amendment; the coordinator writes it.
- No header text changed, so `evals/lib/squeal-text.mjs` and its parser gate are untouched.
- Bundles not rebuilt (`plugins/*/dist` drift is expected until the release build).
