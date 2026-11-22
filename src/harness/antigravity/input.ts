/**
 * The fields of Antigravity hook input that Squeal reads (spec 024 D2, D3,
 * D5): camelCase protojson, one line, zero values present
 * (`research/wave-0-checks.md` 4). Every event carries `conversationId`, the
 * consumer's identity for a main conversation and for a subagent alike, and
 * the workspace `cwd`; hooks run with their own `cwd` set to the plugin root,
 * so the workspace comes from here only.
 */
export interface AntigravityHookInput {
  readonly conversationId: string;
  /** Stdin `cwd`, or `workspacePaths[0]` when it is empty (D2). */
  readonly cwd: string;
  readonly workspacePaths: readonly string[];
  readonly hookEventName: string;
  /** PreInvocation: 0 at each user turn's start, then 1, 2, … after each tool batch. */
  readonly invocationNum?: number;
  readonly initialNumSteps?: number;
  /** PreToolUse: `toolCall.name`, such as `write_file` or `run_command`. */
  readonly toolName?: string;
  /** PreToolUse of `run_command`: `toolCall.args.CommandLine` (spec 005 D8). */
  readonly command?: string;
  /** PreToolUse of `run_command`: `toolCall.args.Cwd`, when the model set one. */
  readonly toolCwd?: string;
  /** Stop: 0, then 1, 2, … after each `"continue"` within the turn (D3's loop guard). */
  readonly executionNum?: number;
  /** Stop: `NO_TOOL_CALL` for a turn that ended itself; an abort or a limit otherwise. */
  readonly terminationReason?: string;
  /** Stop: `false` while the agent waits on a background subagent, command or timer. */
  readonly fullyIdle?: boolean;
  readonly continuationActive?: boolean;
}

type Fields = Record<string, unknown>;

const record = (value: unknown): Fields | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

const number = (v: Fields, key: string): object =>
  typeof v[key] === "number" ? { [key]: v[key] } : {};

const flag = (v: Fields, key: string): object =>
  typeof v[key] === "boolean" ? { [key]: v[key] } : {};

/** PreToolUse's `toolCall`: its name, and a `run_command`'s command line and directory. */
function toolFields(value: unknown): object {
  const call = record(value);
  if (call === null || !nonEmpty(call.name)) return {};
  const args = record(call.args);
  if (call.name !== "run_command" || args === null) return { toolName: call.name };
  return {
    toolName: call.name,
    ...(typeof args.CommandLine === "string" ? { command: args.CommandLine } : {}),
    ...(nonEmpty(args.Cwd) ? { toolCwd: args.Cwd } : {}),
  };
}

/** Parses hook stdin; `null` for anything that is not a hook input object. */
export function parseAntigravityInput(text: string): AntigravityHookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const v = record(value);
  if (v === null || !nonEmpty(v.conversationId) || typeof v.hookEventName !== "string") {
    return null;
  }
  const workspacePaths = Array.isArray(v.workspacePaths) ? v.workspacePaths.filter(nonEmpty) : [];
  const cwd = nonEmpty(v.cwd) ? v.cwd : workspacePaths[0];
  if (cwd === undefined) return null;
  return {
    conversationId: v.conversationId,
    cwd,
    workspacePaths,
    hookEventName: v.hookEventName,
    ...number(v, "invocationNum"),
    ...number(v, "initialNumSteps"),
    ...toolFields(v.toolCall),
    ...number(v, "executionNum"),
    ...(typeof v.terminationReason === "string" ? { terminationReason: v.terminationReason } : {}),
    ...flag(v, "fullyIdle"),
    ...flag(v, "continuationActive"),
  };
}
