// Row 011-180: every `squeal status --wait` call in this host's Codex and Claude Code transcripts in a window, with the
// directory it ran in, read only. Prints one JSON line per call: { ts, cwd, paths }. Usage: node waits.mjs <from ISO> <to ISO>
// <part of the Claude Code project folder name, e.g. projects-cezar>. Paths are as typed: a glob is not expanded.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const [, , from, to, filter] = process.argv;
const since = Date.parse(from) - 6 * 3600e3;
const files = [];
const walk = (d, depth) => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = join(d, e.name); if (e.isDirectory() && depth > 0) walk(p, depth - 1); else if (e.name.endsWith(".jsonl")) { try { if (statSync(p).mtimeMs >= since) files.push(p); } catch {} } } };
walk(`${process.env.HOME}/.codex/sessions/2026/10`, 1);
for (const d of readdirSync(`${process.env.HOME}/.claude/projects`)) if (d.includes(filter)) walk(`${process.env.HOME}/.claude/projects/${d}`, 0);
const out = [];
for (const f of files) {
  let cwd = null; const text = readFileSync(f, "utf8");
  if (!text.includes("--wait")) continue;
  for (const line of text.split("\n")) {
    if (line.includes('"cwd"')) { const m = /"cwd":"([^"]+)"/.exec(line); if (m) cwd = m[1]; }
    if (!line.includes("status") || !line.includes("--wait")) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const ts = j.timestamp ?? ""; if (ts < from || ts > to) continue;
    let cmd = null;
    const p = j.payload;
    if (p && (p.type === "function_call" || p.type === "custom_tool_call")) cmd = typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.input ?? "");
    if (j.message?.content && Array.isArray(j.message.content)) for (const c of j.message.content) if (c.type === "tool_use" && c.name === "Bash") cmd = c.input?.command ?? cmd;
    if (!cmd) continue;
    try { const a = JSON.parse(cmd); cmd = a.cmd ?? a.command ?? cmd; if (Array.isArray(cmd)) cmd = cmd.join(" "); } catch {}
    const m = /squeal\S*\s+status\s+--wait(?:\s+\d+)?((?:\s+[^\s;|&>]+)*)/.exec(String(cmd));
    if (!m) continue;
    const workdir = (/"workdir":"([^"]+)"/.exec(String(p?.arguments ?? "")) ?? [])[1] ?? j.cwd ?? cwd;
    out.push({ ts, cwd: workdir, paths: m[1].trim().split(/\s+/).filter((x) => x && !x.startsWith("-")) });
  }
}
out.sort((a, b) => a.ts.localeCompare(b.ts));
for (const o of out) console.log(JSON.stringify(o));
