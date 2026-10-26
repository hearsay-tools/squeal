// Throwaway probe (016-35). One Cursor hook for every event, from either
// source: `node cursor-hook.mjs <cursor|claude>` (the tag is inside the
// command string, which Cursor keeps; it drops only a Claude entry's `args`).
// It logs one line per call to $HOME/ht035/logs/cursor-hooks.jsonl: the event,
// the payload's keys and a few fields (never user_email), the hook env names
// Squeal reads, and the process ancestry. It answers with NONCE texts, so the
// model can say which of them reached it:
//   sessionStart, beforeSubmitPrompt, postToolUse -> additional_context
//     (claude source: Claude Code's nested hookSpecificOutput form)
//   preToolUse  (cursor) -> deny the first Write of deny-me.txt, agent_message
//   preToolUse  (claude) -> exit 2 + stderr on the first Shell command holding "deny-shell"
//   stop        (cursor) -> followup_message at loop_count 0
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2] ?? "unknown";
const home = process.env.HOME;
const logPath = `${home}/ht035/logs/cursor-hooks.jsonl`;
const once = (name) => {
  const flag = `${home}/ht035/logs/cursor-once-${name}`;
  if (existsSync(flag)) return false;
  writeFileSync(flag, "");
  return true;
};

function ancestry() {
  const chain = [];
  let pid = process.pid;
  for (let i = 0; i < 12 && pid > 1; i++) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const comm = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const argv0 = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0].slice(-60);
      chain.push(`${pid}:${comm}:${argv0}`);
      pid = ppid;
    } catch {
      break;
    }
  }
  return chain;
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
let p = {};
try { p = JSON.parse(input); } catch { p = { unparsed: input.slice(0, 200) }; }
const event = p.hook_event_name ?? "?";
const tool = p.tool_name ?? null;
const pick = {};
for (const k of ["session_id", "conversation_id", "generation_id", "cwd", "workspace_roots", "status", "loop_count", "composer_mode", "is_background_agent", "reason", "model", "transcript_path"]) {
  if (k in p) pick[k] = p[k];
}
if (p.tool_input) pick.tool_input = JSON.stringify(p.tool_input).slice(0, 160);
const env = {};
for (const k of ["CURSOR_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "CURSOR_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "CURSOR_VERSION", "CURSOR_TRANSCRIPT_PATH"]) {
  if (process.env[k] !== undefined) env[k] = process.env[k];
}
let out = null;
let exit = 0;
let stderr = "";
const ctx = (text, claudeEvent) =>
  src === "claude" ? { hookSpecificOutput: { hookEventName: claudeEvent, additionalContext: text } } : { additional_context: text };
if (event === "sessionStart") out = ctx(`NONCE-START-${src}`, "SessionStart");
if (event === "beforeSubmitPrompt") out = ctx(`NONCE-PROMPT-${src}`, "UserPromptSubmit");
if (event === "postToolUse") out = ctx(`NONCE-POST-${src}-${tool}`, "PostToolUse");
if (event === "preToolUse" && src === "cursor" && tool === "Write" && JSON.stringify(p.tool_input ?? {}).includes("deny-me.txt") && once("deny-write")) {
  out = { permission: "deny", agent_message: "NONCE-DENY-cursor: this write is blocked once; issue the same write again.", user_message: "probe: blocked once" };
}
if (event === "preToolUse" && src === "claude" && tool === "Shell" && JSON.stringify(p.tool_input ?? {}).includes("deny-shell") && once("deny-shell")) {
  exit = 2;
  stderr = "NONCE-EXIT2-claude: this shell command is blocked once; run it again.";
}
if (event === "stop" && src === "cursor" && p.loop_count === 0) out = { followup_message: "NONCE-STOP-cursor: reply with only the word CONTINUED." };
appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), src, event, tool, keys: Object.keys(p).sort(), ...pick, env, ancestry: ancestry(), answered: out, exit })}\n`);
if (out) process.stdout.write(JSON.stringify(out));
if (stderr) process.stderr.write(stderr);
process.exit(exit);
