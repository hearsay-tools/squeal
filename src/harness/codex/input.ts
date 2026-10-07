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
  /** The thread's rollout file, named `rollout-<time>-<thread id>.jsonl`. */
  readonly transcript_path?: string;
}

/**
 * A thread Codex runs under the parent's `session_id` without naming it, such
 * as an inline `/review` (spec 002 D2 as amended, `lessons.md` defect 2): no
 * `agent_id`, and a `transcript_path` whose file name ends in the thread's own
 * id rather than `<session_id>.jsonl`. It is not a consumer: its hooks
 * register, deliver, deny and change nothing, as 001 D9 treats Claude Code's
 * forks. An input with no `transcript_path` is the main thread.
 */
export function isUnservedThread(input: CodexHookInput): boolean {
  return (
    input.agent_id === undefined &&
    input.transcript_path !== undefined &&
    !input.transcript_path.endsWith(`${input.session_id}.jsonl`)
  );
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
    ...(typeof v.transcript_path === "string" && v.transcript_path !== ""
      ? { transcript_path: v.transcript_path }
      : {}),
  };
}
