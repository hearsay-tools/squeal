# Wave 6.5 worker brief

Ready-to-dispatch task text for board row 001-50, from `reviews/wave-6.md`. One worker (`--backend claude --model opus --effort high`, never Fable) from the current main. No siblings run in parallel. The coordinator rebuilds the bundles and amends D9 at integration.

## 001-50 wave 6 review fixes

You are a Worker on the Squeal project, wave 6.5 (fixes from the wave 6 review). Use /worker. Read docs/styleguide.md, docs/specifications/001-core-loop/spec.md D9 and D10, status.md (the two 2026-10-06 wave 6 lines), docs/specifications/001-core-loop/reviews/wave-6.md in full (S1, S2, N2, N4 and "Inputs for the next wave"), and src/harness/claude-code/ end to end. Test first. Before finishing run npm ci, npm run lint, npm run typecheck and npx vitest run, and paste the output. Do not run npm run build and do not commit anything under plugins/claude-code/dist; if a bundle-drift test fails only because bundles are stale, say so. Small conventional commits naming the finding (S1, S2, N2, N4). No new dependencies, no type changes beyond additive ones. Do not edit the spec, status.md, lessons.md, the review or board.md: the coordinator amends D9 with the review's proposed sentences; tell it in your final message if any of them no longer matches what you built.

Scope.
- S1: `src/harness/claude-code/hooks/user-prompt-submit.ts` injects `formatRegistration(registration)` whenever it registers (a store created after SessionStart, or a consumer expired while idle), as SessionStart and PostToolBatch do. The registered path stays silent and only records the consumer as heard from. `-p` still registers nothing. Update its doc comment.
- S2: in `src/harness/claude-code/hooks/stop.ts`, a SubagentStop whose consumer has no registration gets the fork behaviour: no registration, no block, no output, no daemon ensure. The empty `agent_type` rule in `fork.ts` stays as the first check. A main agent's Stop is unchanged (an unregistered main agent still registers through `newsText`). Update the doc comments of `stop.ts` and `fork.ts`, including the `--agent` limitation, which this rule now covers.
- N4: PostToolBatch and PreToolUse return early for `isFork(input)`, so a fork never registers through them.
- N2: a test for the staleness re-check inside the expiry transaction (`src/core/delivery/delivery.ts` `expireConsumers`): a consumer touched after `idleSince` read it as idle is kept. A store wrapper whose `consumers.idleSince` returns a stale snapshot is enough.

Done when:
- A fresh store's recorded UserPromptSubmit injects the header (`SQUEAL` line).
- An expired consumer with an untold recovery gets the header with 0 known failures.
- In `-p` mode, UserPromptSubmit still registers nothing.
- `subagent-stop.json` with `agent_type: "helper"`, no SubagentStart, the policy on and one failure current: no block, no output, no consumer row.
- A registered real subagent with the same policy is still blocked.
- A fork's PostToolBatch and PreToolUse leave no consumer row.
- The N2 test passes.

Owns: `src/harness/claude-code/hooks/user-prompt-submit.ts`, `hooks/stop.ts`, `hooks/post-tool-batch.ts`, `hooks/pre-tool-use.ts`, `src/harness/claude-code/fork.ts`, `test/harness/user-prompt-submit.test.ts`, `test/harness/stop.test.ts`, `test/harness/forks.test.ts`, `test/harness/hooks.test.ts`, `test/harness/bundles.test.ts`, `test/harness/recorded/` (new recordings only, plus its README), `test/delivery/expiry.test.ts`. Everything else is read-only; ask the coordinator before touching another file.

## After it lands

The coordinator rebuilds bundles, amends D9 with the four sentences of `reviews/wave-6.md` "Inputs for the next wave" item 2 (the idle-waiter one is already in), and runs a short attended check of A8 (first session on a new store shows the header) and G1 (`--agent` fork not blocked) through a reviewer or by hand.
