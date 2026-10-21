// Extracts named `squeal status --wait <ms> <paths>` calls from Claude Code and Codex transcripts
// of cezar worktrees (read-only): time asked, time answered, worktree root, paths, a hint of the reply.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const HOME = "/home/agent";
const out = [];
const WAIT = /status\s+--wait\s+(\d+)((?:\s+[^\s;&|"'\\]+)*)/g;
function parseCmd(text) {
  const found = [];
  for (const m of text.matchAll(WAIT)) {
    const paths = m[2].trim().split(/\s+/).filter((p) => p && !p.startsWith("-") && /\.(test|spec)\.[cm]?[jt]sx?$|\.e2e\.ts$/.test(p));
    found.push({ ms: Number(m[1]), paths });
  }
  return found;
}
const hint = (s) => {
  const t = String(s);
  return {
    behindTier: /behind the vitest tier running since (\d\d:\d\d:\d\d)/.exec(t)?.[1] ?? null,
    notListed: /not listed yet/.test(t),
    running: /running since (\d\d:\d\d:\d\d) in its lane/.exec(t)?.[1] ?? null,
    exit3: /exit(?:ed)? (?:code )?3|Exit code 3|exit_code":3|"exit_code": 3/.test(t),
  };
};
// Claude Code
const cdir = join(HOME, ".claude/projects");
for (const d of readdirSync(cdir)) {
  if (!d.startsWith("-home-agent-projects-cezar")) continue;
  for (const f of readdirSync(join(cdir, d))) {
    if (!f.endsWith(".jsonl")) continue;
    const text = readFileSync(join(cdir, d, f), "utf8");
    if (!text.includes("--wait")) continue;
    const calls = new Map();
    for (const line of text.split("\n")) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const content = j.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c.type === "tool_use" && typeof c.input?.command === "string" && c.input.command.includes("squeal") ) {
          for (const w of parseCmd(c.input.command)) calls.set(c.id, { src: "claude", file: f, cwd: j.cwd, at: Date.parse(j.timestamp), ...w });
        }
        if (c.type === "tool_result" && calls.has(c.tool_use_id)) {
          const call = calls.get(c.tool_use_id);
          const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
          out.push({ ...call, endAt: Date.parse(j.timestamp), ...hint(body), isError: c.is_error === true });
          calls.delete(c.tool_use_id);
        }
      }
    }
  }
}
// Codex
const xdir = join(HOME, ".codex/sessions/2026/10");
for (const day of readdirSync(xdir)) {
  for (const f of readdirSync(join(xdir, day))) {
    const text = readFileSync(join(xdir, day, f), "utf8");
    if (!text.includes("/projects/cezar") || !text.includes("--wait")) continue;
    let cwd = null;
    const calls = new Map();
    for (const line of text.split("\n")) {
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      const p = j.payload ?? {};
      if (j.type === "session_meta") cwd = p.cwd;
      if (j.type === "turn_context" && p.cwd) cwd = p.cwd;
      if (p.type === "custom_tool_call" || p.type === "function_call") {
        const input = typeof p.input === "string" ? p.input : String(p.arguments ?? "");
        if (!input.includes("squeal")) continue;
        const un = input.replace(/\\"/g, '"').replace(/\\n/g, "\n");
        for (const w of parseCmd(un)) calls.set(p.call_id, { src: "codex", file: f, cwd, at: Date.parse(j.timestamp), ...w });
      }
      if ((p.type === "custom_tool_call_output" || p.type === "function_call_output") && calls.has(p.call_id)) {
        out.push({ ...calls.get(p.call_id), endAt: Date.parse(j.timestamp), ...hint(JSON.stringify(p.output ?? "")) });
        calls.delete(p.call_id);
      }
    }
  }
}
out.sort((a, b) => a.at - b.at);
writeFileSync("/tmp/r381/waits.json", JSON.stringify(out, null, 1));
const named = out.filter((w) => w.paths.length > 0);
console.log(`waits ${out.length}, named with a test path ${named.length}, claude ${out.filter((w) => w.src === "claude").length}, codex ${out.filter((w) => w.src === "codex").length}`);
console.log(`range ${new Date(out[0]?.at).toISOString()} .. ${new Date(out.at(-1)?.at).toISOString()}`);
console.log(`named: behind tier ${named.filter((w) => w.behindTier).length}, not listed ${named.filter((w) => w.notListed).length}`);
