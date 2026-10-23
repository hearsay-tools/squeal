// 011-148 probe (throwaway): agent turn ends per worktree root, from Claude Code (Stop hook summaries) and Codex (task_complete).
// Usage: node turns.mjs <out.json> <worktree root>...   Reads transcripts read only; writes {root: [epoch ms]}.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
const [, , outPath, ...roots] = process.argv;
const out = {};
const want = new Set(roots);
for (const root of roots) {
  out[root] = [];
  const dir = `${homedir()}/.claude/projects/${root.replace(/[/.]/g, "-")}`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(`${dir}/${f}`, "utf8").split("\n")) {
      if (!line.includes('"stop_hook_summary"')) continue;
      try { const l = JSON.parse(line); if (l.subtype === "stop_hook_summary" && !l.isSidechain) out[root].push(Date.parse(l.timestamp)); } catch {}
    }
  }
}
const base = `${homedir()}/.codex/sessions/2026/10`;
for (const day of existsSync(base) ? readdirSync(base).filter((d) => d >= "19") : []) {
  for (const f of readdirSync(`${base}/${day}`).filter((f) => f.endsWith(".jsonl"))) {
    const text = readFileSync(`${base}/${day}/${f}`, "utf8");
    const first = text.slice(0, text.indexOf("\n"));
    let cwd; try { cwd = JSON.parse(first).payload?.cwd; } catch { continue; }
    if (!want.has(cwd)) continue;
    for (const line of text.split("\n")) if (line.includes('"task_complete"')) { try { out[cwd].push(Date.parse(JSON.parse(line).timestamp)); } catch {} }
  }
}
for (const r of roots) out[r].sort((a, b) => a - b);
writeFileSync(outPath, JSON.stringify(out));
console.log(Object.entries(out).map(([r, t]) => `${t.length} ${r}`).join("\n"));
