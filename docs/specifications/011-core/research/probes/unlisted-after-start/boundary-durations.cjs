// Throwaway probe (011-385). PostToolBatch hook outcomes and durations in Claude Code transcripts
// of Squawk task worktrees (read-only), by day. Usage: node boundary-durations.cjs <since> <dir-prefix>
const fs = require("fs"), path = require("path");
const [since, prefix] = process.argv.slice(2);
const root = path.join(process.env.HOME, ".claude/projects");
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const days = {};
for (const d of fs.readdirSync(root).filter((d) => d.startsWith(prefix)))
  for (const f of fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(root, d, f), "utf8").split("\n")) {
      if (!line.includes('"PostToolBatch"') || !line.includes('"attachment"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const a = o.attachment; if (!a || a.hookEvent !== "PostToolBatch" || a.type === "hook_additional_context" || o.timestamp < since) continue;
      const day = o.timestamp.slice(0, 10); const x = (days[day] ??= { timeout: 0, text: [], silent: [] });
      if (a.timedOut) x.timeout++;
      else if (a.type === "hook_success") (/SQUEAL/.test(a.stdout ?? "") ? x.text : x.silent).push(a.durationMs);
    }
  }
for (const [day, x] of Object.entries(days).sort()) {
  const n = x.timeout + x.text.length + x.silent.length;
  console.log(day, `n=${n} timedOut ${(100 * x.timeout / n).toFixed(0)}%`, `text n=${x.text.length} median ${q(x.text, 0.5)} p90 ${q(x.text, 0.9)}`, `silent n=${x.silent.length} median ${q(x.silent, 0.5)} p90 ${q(x.silent, 0.9)}`);
}
