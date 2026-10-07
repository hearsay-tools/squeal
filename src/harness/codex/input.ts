/**
 * The fields of Codex hook input that Squeal reads (spec 002 D2, D5). Every
 * event carries `session_id` (the thread id), `cwd` (the thread's working
 * directory, the hook's root) and `hook_event_name`; turn events add
 * `turn_id`; a subagent's own events add `agent_id` (its thread id) and
 * `agent_type`, and the main thread's carry neither (research, codex-hooks 2).
 * Hooks get no `CODEX_*` id variables, so identity comes from here only.
 */
export interface CodexHookInput {
  readonly session_id: string;
  readonly cwd: string;
  readonly hook_event_name: string;
  readonly agent_id?: string;
  readonly agent_type?: string;
  readonly turn_id?: string;
  /** PreToolUse and PostToolUse: `Bash`, `apply_patch` (also for `Edit` and `Write`), others. */
  readonly tool_name?: string;
  /** Stop and SubagentStop: true while a Stop hook's block keeps the turn going. */
  readonly stop_hook_active?: boolean;
  /** SessionStart: `startup`, `resume`, `fork`, `clear` or `compact`. */
  readonly source?: string;
}

/** Parses hook stdin; `null` for anything that is not a hook input object. */
export function parseCodexInput(text: string): CodexHookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.session_id !== "string" || v.session_id === "") return null;
  if (typeof v.cwd !== "string" || v.cwd === "") return null;
  if (typeof v.hook_event_name !== "string") return null;
  return {
    session_id: v.session_id,
    cwd: v.cwd,
    hook_event_name: v.hook_event_name,
    ...(typeof v.agent_id === "string" && v.agent_id !== "" ? { agent_id: v.agent_id } : {}),
    ...(typeof v.agent_type === "string" ? { agent_type: v.agent_type } : {}),
    ...(typeof v.turn_id === "string" ? { turn_id: v.turn_id } : {}),
    ...(typeof v.tool_name === "string" ? { tool_name: v.tool_name } : {}),
    ...(typeof v.stop_hook_active === "boolean" ? { stop_hook_active: v.stop_hook_active } : {}),
    ...(typeof v.source === "string" ? { source: v.source } : {}),
  };
}
