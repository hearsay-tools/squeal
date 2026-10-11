// One timeline from a subject session's transcript (spec 006 D4): Claude Code `stream-json`, or
// Codex `exec --json` plus its rollout, which holds the SQUEAL texts the model received.
// Entries: `cmd { cmd, ms, exit, out, refused }`, `edit { path, refused, failed }`, `read { path }`,
// `skill`, `say { text }`, `squeal { hook, text }`, `tool { name }`; `t` is ms since session start.

const SQUEAL_TEXT = /SQUEAL|Squeal runs/;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Claude Code's answer to a tool call its permission rules refused, or a PreToolUse hook denied.
const CLAUDE_REFUSAL =
  /requested permissions to use|haven't granted it yet|permission to use [\w ]+ (?:has been|was) denied|hook (?:error|denied|blocked)|denied this tool|blocked by (?:a )?hook/i;
export const SKILL_PATH = /skills\/squeal\/(?:SKILL\.md|references\/)/;

/** Claude Code `stream-json` events, each with `t`. */
export function claudeTimeline(events) {
  const items = [];
  const byToolId = new Map();
  const result = { items, final: "", cost: null, usage: null, turns: null, reachedModel: false };
  let pendingDeny = null;
  for (const e of events) {
    if (e.type === "assistant") {
      result.reachedModel = true;
      for (const c of e.message?.content ?? []) {
        if (c.type === "text") items.push({ t: e.t, kind: "say", text: c.text });
        if (c.type === "tool_use") byToolId.set(c.id, items[items.push(claudeTool(e.t, c)) - 1]);
      }
    }
    if (e.type === "system" && e.subtype === "hook_response") {
      const text = String(e.output ?? "");
      if (SQUEAL_TEXT.test(text)) items.push({ t: e.t, kind: "squeal", hook: e.hook_name, text });
      if (/"permissionDecision":\s*"deny"|"decision":\s*"block"/.test(text)) pendingDeny = e.t;
    }
    if (e.type === "user") {
      for (const c of Array.isArray(e.message?.content) ? e.message.content : []) {
        const k = c.type === "tool_result" ? byToolId.get(c.tool_use_id) : undefined;
        if (!k) continue;
        k.ms = e.t - k.t;
        const out = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
        if (k.kind === "cmd") k.out = out;
        const denied = pendingDeny !== null && pendingDeny >= k.t;
        if (c.is_error && (CLAUDE_REFUSAL.test(out) || denied)) k.refused = true;
        if (denied) pendingDeny = null;
        // Claude Code reports a non-zero exit as an error result opening with `Exit code N`.
        if (k.kind === "cmd" && !k.background && !k.refused)
          k.exit = c.is_error ? Number(/^Exit code (\d+)/.exec(out)?.[1] ?? Number.NaN) : 0;
        if (Number.isNaN(k.exit)) k.exit = null;
        if (k.kind === "edit" && c.is_error && !k.refused) k.failed = true;
      }
    }
    if (e.type === "result") {
      result.cost = e.total_cost_usd ?? null;
      result.final = e.result ?? "";
      result.turns = e.num_turns ?? null;
      result.usage = e.usage ?? null;
      for (const d of e.permission_denials ?? []) {
        const k = byToolId.get(d.tool_use_id);
        if (k) k.refused = true;
      }
    }
  }
  return result;
}

function claudeTool(t, c) {
  const i = c.input ?? {};
  if (c.name === "Bash")
    return { t, kind: "cmd", cmd: String(i.command ?? ""), background: !!i.run_in_background };
  if (EDIT_TOOLS.has(c.name))
    return { t, kind: "edit", path: String(i.file_path ?? i.notebook_path ?? "") };
  if (c.name === "Read")
    return {
      t,
      kind: SKILL_PATH.test(i.file_path ?? "") ? "skill" : "read",
      path: String(i.file_path ?? ""),
    };
  if (c.name === "Skill")
    return { t, kind: /squeal/i.test(JSON.stringify(i)) ? "skill" : "tool", name: c.name };
  return { t, kind: "tool", name: c.name };
}

/**
 * Codex `exec --json` events, each with `t`, and the session's rollout records (`timestamp`,
 * `payload`) with `t0`, the session's start in ms since the epoch.
 */
export function codexTimeline(events, rollout = [], t0 = 0) {
  const items = [];
  const open = new Map();
  const result = {
    items,
    final: "",
    cost: null,
    usage: null,
    turns: null,
    reachedModel: false,
    thread: null,
  };
  for (const e of events) {
    if (e.type === "thread.started") result.thread = e.thread_id;
    if (e.type === "turn.completed") result.usage = e.usage ?? null;
    const i = e.item;
    if (!i) continue;
    if (i.type !== "error") result.reachedModel = true;
    if (i.type === "command_execution") {
      let k = open.get(i.id);
      if (!k) {
        k = { t: e.t, kind: "cmd", cmd: String(i.command) };
        open.set(i.id, k);
        items.push(k);
      }
      if (e.type === "item.completed" || i.status === "declined") {
        k.ms = e.t - k.t;
        k.exit = i.exit_code ?? null;
        k.out = i.aggregated_output ?? "";
        if (i.status === "declined") k.refused = true;
      }
    }
    if (i.type === "file_change" && e.type === "item.completed") {
      for (const c of i.changes ?? [])
        items.push({
          t: e.t,
          kind: "edit",
          path: c.path,
          refused: i.status === "declined",
          failed: i.status === "failed",
        });
    }
    if (i.type === "agent_message" && e.type === "item.completed") {
      items.push({ t: e.t, kind: "say", text: i.text });
      result.final = i.text;
    }
  }
  for (const r of rollout) {
    const p = r.payload ?? {};
    if (p.type !== "message" || p.role !== "developer") continue;
    for (const c of p.content ?? []) {
      if (SQUEAL_TEXT.test(c.text ?? ""))
        items.push({
          t: Date.parse(r.timestamp) - t0,
          kind: "squeal",
          hook: "developer",
          text: c.text,
        });
    }
  }
  items.sort((a, b) => a.t - b.t);
  return result;
}

/** The effort level the harness recorded (005-07): Claude Code transcript lines, Codex rollout. */
export function reportedEffort(harness, records) {
  const seen = new Set();
  for (const r of records) {
    if (harness === "claude" && r.type === "assistant" && "effort" in r) seen.add(String(r.effort));
    if (harness === "codex" && r.type === "turn_context")
      seen.add(String(r.payload?.effort ?? r.payload?.reasoning_effort ?? null));
  }
  return seen.size ? [...seen].sort().join(",") : "not reported";
}
