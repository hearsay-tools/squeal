/**
 * The fields of Claude Code hook input that Squeal reads. Every hook gets
 * `session_id`, `cwd` and `hook_event_name`; subagent events and events fired
 * inside a subagent add `agent_id` (research, claude-code-integration §5).
 */
export interface HookInput {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
  readonly agent_id?: string;
  /** PreToolUse. */
  readonly tool_name?: string;
  /** Stop and SubagentStop: true while a Stop hook's block keeps the agent going. */
  readonly stop_hook_active?: boolean;
}

/** Parses hook stdin; `null` for anything that is not a hook input object. */
export function parseHookInput(text: string): HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.session_id !== "string" || v.session_id === "") return null;
  if (typeof v.cwd !== "string" || v.cwd === "") return null;
  if (typeof v.hook_event_name !== "string") return null;
  return {
    session_id: v.session_id,
    cwd: v.cwd,
    hook_event_name: v.hook_event_name,
    ...(typeof v.agent_id === "string" && v.agent_id !== "" ? { agent_id: v.agent_id } : {}),
    ...(typeof v.tool_name === "string" ? { tool_name: v.tool_name } : {}),
    ...(typeof v.stop_hook_active === "boolean" ? { stop_hook_active: v.stop_hook_active } : {}),
  };
}
