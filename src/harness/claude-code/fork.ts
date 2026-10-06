import type { HookInput } from "./input.js";

/**
 * Agent types that mark one of Claude Code's internal forked agents: not a
 * consumer, since it never reads Squeal output (lessons, defect 9).
 *
 * - `""`: the hooks reference (code.claude.com/docs/en/hooks, SubagentStop,
 *   fetched 2026-10-06) says internal agents such as prompt suggestions and
 *   `/btw` side questions report "the agent name the session itself runs as
 *   ... and an empty string when the session runs without one". Observed with
 *   Claude Code 2.1.291 in an attended `--debug hooks` session: the
 *   `prompt_suggestion` fork and the `side_question` fork (debug-log labels)
 *   both sent SubagentStop with `agent_type: ""`, no SubagentStart, and no
 *   other hook. `prompt_suggestion` is the fork's debug label and API
 *   request source, never its `agent_type`.
 *
 * Under `--agent <name>` a fork reports `<name>`, the same as a real subagent
 * of that type, so the input cannot tell them apart. Stop covers that case
 * with a second rule, checked after this one (review wave 6, S2): a
 * SubagentStop whose consumer was never registered is treated as a fork's,
 * since a real subagent is registered by SubagentStart or its first
 * PostToolBatch.
 */
export const FORK_AGENT_TYPES: ReadonlySet<string> = new Set([""]);

/** A subagent event of an internal fork. A missing `agent_type` is a real subagent. */
export function isFork(input: HookInput): boolean {
  return (
    input.agent_id !== undefined &&
    input.agent_type !== undefined &&
    FORK_AGENT_TYPES.has(input.agent_type)
  );
}
