# Fetched sources and decisive excerpts

Fetched 2026-10-09. These excerpts are evidence, not execution instructions.

## Claude Code official hooks reference

https://code.claude.com/docs/en/hooks.md, fetched alongside installed binary 2.1.295.

> `updatedInput`: Modifies the tool's input parameters before execution. Replaces the entire input object, so include unchanged fields alongside modified ones. Claude Code evaluates permission rules and a Bash command's auto-background eligibility against the input your hook returns, not the input Claude sent.

> `permissionDecision`: `"allow"` skips the permission prompt [...] Deny and ask rules are still evaluated regardless of what the hook returns.

> `additionalContext`: String added to Claude's context alongside the tool result.

The `if` examples say `Bash(git *)` also matches `npm test && git push`, and that the filter runs the handler conservatively when command analysis is uncertain. Thus `if` is a launch filter, not a safe takeover matcher.

## Codex official hooks reference

https://developers.openai.com/codex/hooks, fetched 2026-10-09:

> Return `updatedInput` only with `permissionDecision: "allow"`; other `updatedInput` shapes are reported as errors.

> `permissionDecision: "ask"`, legacy `decision: "approve"`, `continue: false`, `stopReason`, and `suppressOutput` are parsed but not supported yet. Codex marks the hook run as failed, reports the error, and continues the tool call.

## Codex source

https://github.com/openai/codex/tree/rust-v0.160.1, downloaded tag archive to the scratch root. Same tag as spec 002's `d27764b` source inspection.

- `codex-rs/hooks/src/engine/output_parser.rs:438-478`: `updated_input.is_some()` without `permission_decision == Allow` returns `PreToolUse hook returned updatedInput without permissionDecision:allow`. Allow without input returns `unsupported permissionDecision:allow`; Ask returns `unsupported permissionDecision:ask`.
- `codex-rs/hooks/src/events/pre_tool_use.rs:220-252`: invalid output marks the hook failed; only valid output passes `updated_input` onward. Invalid output does not block the tool.
- `codex-rs/core/src/tools/registry.rs:628`: a continued hook with input calls `tool.with_updated_hook_input(...)`.
- `codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:533`: replaces `args.cmd`, retains other exec arguments, and returns the rewritten invocation. The ordinary tool permission path still applies; the hook is not an approval grant.

## Pinned Squeal source

Squeal 0.1.67, commit `9848df0571da95cdfd0fe7b8303873deb0fa8414`:

- `src/cli/run.ts:12-118`: only `--all`, `--force`, `--wait` (and separate slow mode); wait polls indefinitely, checks daemon liveness, formats status, then `return end === "completed" ? 0 : 1`. No failure-count test in the exit decision.
- `src/harness/shared/stop.ts:60-130,163-197`: policy checks the current checkpoint, returns a blocking reason, never queues a run; `stopHookActive` suppresses a second policy block.
- `src/harness/shared/primer.ts`; `plugins/claude-code/skills/squeal/SKILL.md`: allow manual runs when a repository gate requires one.
- `docs/specifications/001-core-loop/spec.md` D5-D7, D9, D11; `002-codex-adapter/spec.md` D2-D3: current-key reuse, explicit checkpoint semantics, bounded hooks, report provenance.
- `docs/specifications/001-core-loop/lessons.md` Setup and agent behavior; `002-codex-adapter/lessons.md` dogfooding defect 5; `004-slow-suites/lessons.md` agent behavior: independent direct runs sometimes detect wrong Squeal evidence, so eliminating every independent run is not the goal.
