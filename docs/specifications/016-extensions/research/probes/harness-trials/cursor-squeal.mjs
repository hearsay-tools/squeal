// Throwaway probe (016-35). The two Node halves of cursor-squeal.sh, the
// smallest Cursor adapter for Squeal as a sketch: Squeal's shipped Claude Code
// bundle runs between them, a child of the shell script, so Squeal's walk up
// from the bundle's parent skips sh and bash and finds cursor-agent as the
// session's process. (In c4 a single Node translator was the bundle's parent:
// Squeal took it as the session's process, saw it exit after every hook,
// registered the session again at every tool boundary and let the daemon stop.)
//   node cursor-squeal.mjs in <dir>          Cursor payload on stdin -> Claude Code input on stdout
//   node cursor-squeal.mjs out <dir> <exit>  the bundle's stdout in <dir>/out -> Cursor answer on stdout
// Input:  session_id <- conversation_id; cwd <- cwd, else workspace_roots[0]
//         (Cursor sends cwd ""); hook_event_name <- the Claude name; tool_name
//         Shell -> Bash and every file-writing tool -> Edit; postToolUse ->
//         PostToolBatch with one tool_calls entry; stop_hook_active <- loop_count > 0.
// Output: hookSpecificOutput.additionalContext -> additional_context (start,
//         post tool) or followup_message (stop); permissionDecision deny ->
//         permission deny with the reason as user_message and agent_message;
//         decision block -> followup_message.
// Each call is logged to $HOME/ht035/logs/cursor-squeal.jsonl: the mapped
// input, the bundle's exit and stdout, and the answer given to Cursor. The
// payload's user_email is never read into the log.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const [mode, dir, exitText] = process.argv.slice(2);
const EVENTS = { sessionStart: "SessionStart", preToolUse: "PreToolUse", postToolUse: "PostToolBatch", stop: "Stop" };
const EDITS = new Set(["Write", "Edit", "StrReplace", "MultiEdit", "Delete", "EditNotebook"]);
const toolName = (name) => (name === "Shell" ? "Bash" : EDITS.has(name) ? "Edit" : name);

if (mode === "in") {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const p = JSON.parse(raw);
  const event = EVENTS[p.hook_event_name];
  const cwd = p.cwd || p.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || "";
  const input = {
    session_id: p.conversation_id ?? p.session_id,
    cwd,
    hook_event_name: event,
    ...(p.transcript_path ? { transcript_path: p.transcript_path } : {}),
    ...(p.tool_name ? { tool_name: toolName(p.tool_name), tool_input: p.tool_input ?? {} } : {}),
    ...(event === "PostToolBatch" ? { tool_calls: [{ tool_name: toolName(p.tool_name), tool_input: p.tool_input ?? {} }] } : {}),
    ...(event === "Stop" ? { stop_hook_active: (p.loop_count ?? 0) > 0 } : {}),
  };
  writeFileSync(`${dir}/meta`, JSON.stringify({ cursorEvent: p.hook_event_name, loop_count: p.loop_count, cwd }));
  process.stdout.write(JSON.stringify(input));
} else {
  const meta = JSON.parse(readFileSync(`${dir}/meta`, "utf8"));
  const input = JSON.parse(readFileSync(`${dir}/in`, "utf8"));
  const stdout = readFileSync(`${dir}/out`, "utf8");
  const stderr = readFileSync(`${dir}/err`, "utf8");
  let squeal = null;
  try {
    squeal = stdout.trim() === "" ? null : JSON.parse(stdout);
  } catch {
    squeal = { unparsed: stdout.slice(0, 300) };
  }
  const spec = squeal?.hookSpecificOutput;
  let out = null;
  if (spec?.permissionDecision === "deny") {
    out = { permission: "deny", user_message: spec.permissionDecisionReason, agent_message: spec.permissionDecisionReason };
  } else if (squeal?.decision === "block") {
    out = { followup_message: squeal.reason };
  } else if (spec?.additionalContext) {
    out = meta.cursorEvent === "stop" ? { followup_message: spec.additionalContext } : { additional_context: spec.additionalContext };
  }
  appendFileSync(
    `${process.env.HOME}/ht035/logs/cursor-squeal.jsonl`,
    `${JSON.stringify({ at: new Date().toISOString(), ...meta, input, exit: Number(exitText), stderr: stderr.slice(0, 300), squeal, out })}\n`,
  );
  if (out) process.stdout.write(JSON.stringify(out));
  if (exitText === "2") process.stderr.write(stderr);
}
