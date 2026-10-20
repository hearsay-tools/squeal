// One timeline from a subject session's transcript (spec 006 D4): Claude Code `stream-json`, or
// Codex `exec --json` plus its rollout, which holds the SQUEAL texts the model received.
// Entries: `cmd { cmd, ms, exit, out, refused }`, `edit { path, refused, failed }`, `read { path }`,
// `skill`, `say { text }`, `squeal { hook, text }`, `tool { name }`; `t` is ms since session start.
// From a timeline, the numbered and trimmed transcript the judge reads (D9).

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
      // An API error is written as the session's only assistant text: it never reached the model.
      if (
        e.is_error &&
        /^API Error\b/.test(result.final) &&
        !result.items.some((i) => i.kind !== "say")
      )
        result.reachedModel = false;
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

// ---------- the judge's transcript (D9) ----------

/** Output that names Squeal anywhere: kept whole up to `WHOLE_CAP`. */
const SQUEAL_OUTPUT = /SQUEAL|Squeal|squeal/;
/** Output lines a runner's summary or a failure is made of: kept whole. */
const SUMMARY =
  /Test Files|^\s*Tests\s|^\s*Duration|^# (?:tests|suites|pass|fail|cancelled|skipped|todo)\b|^\s*(?:✓|✗|×|❯|↓|FAIL|PASS)\s|\.(?:test|spec)\.[cm]?[jt]sx?\b|^not ok|^ok \d|[Nn]o test files found|[Ff]ilter|[Ee]xclud|[Ee]rror|^Exit code/;
/**
 * Squeal's evidence: a header, counts, a check and its change, a tier or checkpoint line, and
 * from row 011-29 status's `Outstanding:` groups (a down daemon among them) and `More:` line.
 * Kept whole.
 */
const SQUEAL_EVIDENCE =
  /^\s*(?:SQUEAL ·|Revision\b|Known failures|Affected checks|Full-suite checkpoint|Slow tier|Test files without checks|Returned |Checkpoint |Daemon:|Not shown:|Not validated|Outstanding:|More: )|^ {2}(?:\d+ test files? |no daemon has validated|the daemon is still listing|a checkpoint in progress)|^\s*(?:FAIL|PASS|RESOLVED|UNKNOWN) {2}|->|observed at revision|seen by Squeal|checks recovered|still failing|\b(?:current|pending|stale|unknown)\b.*\brevision \d+/;
const LINE_CAP = 400;
const HEAD = 3;
const TAIL = 3;
const WHOLE_CAP = 8000;

/** A path inside the cell's work tree, relative to it. */
const rel = (p) => String(p).replace(/^.*?\/work\//, "");

/**
 * Command output for the judge (D9). Squeal's text is kept whole up to `WHOLE_CAP` characters;
 * beyond it, every evidence line (`SQUEAL_EVIDENCE`) and runner summary line is still kept whole
 * and only the rest is trimmed (review 006-24, S1). Output with "squeal" anywhere counts as
 * Squeal's, a runner's header naming `/tmp/squeal-evals/` included, so the summary lines stay
 * there too (review 006-27). Other output keeps its runner summary lines whole and trims the
 * rest, capping incidental lines at `LINE_CAP`. Every cut says how much it cut.
 */
export function trimOutput(out, whole) {
  const text = String(out ?? "").replace(/\s+$/, "");
  if (whole && text.length <= WHOLE_CAP) return text;
  const lines = text.split("\n");
  const kept = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    const keep = SUMMARY.test(line) || (whole && SQUEAL_EVIDENCE.test(line));
    if (keep || i < HEAD || i >= lines.length - TAIL) {
      if (skipped) kept.push(`[… ${skipped} lines trimmed]`);
      skipped = 0;
      kept.push(keep || line.length <= LINE_CAP ? line : `${line.slice(0, LINE_CAP)} [… trimmed]`);
    } else skipped++;
  });
  if (skipped) kept.push(`[… ${skipped} lines trimmed]`);
  return kept.join("\n");
}

/**
 * The numbered, trimmed transcript D9 describes, from a `claudeTimeline` or `codexTimeline`
 * result: each command with its exit code and output, each Squeal message whole, each edit with
 * its path, each skill load, and the final message. Step `n` is index `n - 1`. Secret scanning
 * is the caller's: the run redacts every step before it is kept or sent.
 */
export function transcriptOf(timeline) {
  const steps = [];
  for (const k of timeline.items) {
    if (k.kind === "squeal") steps.push(`Squeal message:\n${k.text}`);
    if (k.kind === "skill") steps.push("loaded Squeal's skill");
    if (k.kind === "edit")
      steps.push(`edit ${rel(k.path)}${k.refused ? " (refused)" : k.failed ? " (failed)" : ""}`);
    if (k.kind !== "cmd") continue;
    const status = k.refused
      ? "refused, not run"
      : k.background
        ? "started in the background"
        : `exit ${k.exit ?? "unknown"}`;
    const whole = /\bsqueal\b/.test(k.cmd) || SQUEAL_OUTPUT.test(k.out ?? "");
    const out = k.refused ? "" : trimOutput(k.out, whole);
    steps.push(`$ ${k.cmd}\n(${status})${out ? `\n${out}` : ""}`);
  }
  steps.push(`final message:\n${timeline.final ?? ""}`);
  return steps;
}
