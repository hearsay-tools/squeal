// Throwaway, read-only: for each transcript given, lists every slow-tier delivery
// (a SQUEAL block whose provenance reads "slow tier, Squeal's run saw it") with the hook
// that carried it, the transition and the check, de-duplicated per check and transition;
// then every Bash command the agent ran that runs slow files itself (squeal run --slow,
// squeal run --all, a named squeal wait on an e2e path, npm/pnpm/vitest on e2e).
// Usage: node slow-deliveries.mjs <transcript.jsonl>...
import { readFileSync } from "node:fs";

const texts = (v) => {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (typeof v === "object") return [v.text, v.content, v.stdout, v.additionalContext, v.hookSpecificOutput].flatMap(texts);
  return [];
};
const SELF = /squeal run --slow|squeal run --all|squeal (status --wait|why|retry)[^|;&]*e2e|(npm|pnpm|npx)[^|;&]*(e2e|test:package|test:browser)|vitest[^|;&]*e2e/;

for (const file of process.argv.slice(2)) {
  console.log(`== ${file}`);
  const seen = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const t = (e.timestamp ?? "").slice(5, 19).replace("T", " ");
    const sources = [];
    if (e.attachment) sources.push([`hook:${e.attachment.hookEvent ?? e.attachment.type}`, texts(e.attachment)]);
    if (e.type === "user" && Array.isArray(e.message?.content))
      for (const b of e.message.content) if (b.type === "tool_result") sources.push(["tool_result", texts(b.content)]);
    for (const [via, ss] of sources) for (const s of ss) {
      if (!s.includes("slow tier, Squeal")) continue;
      // Each delivered check: "<STATE> [project] path > name ... <transition>, slow tier, Squeal's run saw it at revision N"
      const re = /(PASS -> FAIL|FAIL -> PASS|first observed: FAIL|[A-Z]+ -> [A-Z]+), slow tier, Squeal's run saw it at revision (\d+)/g;
      for (const m of s.matchAll(re)) {
        const before = s.slice(0, m.index);
        const h = [...before.matchAll(/(FAIL|PASS|UNKNOWN) +\[([^\]]+)\] (\S+) > ([^\n]*)/g)].pop();
        const what = h ? `[${h[2]}] ${h[3]} > ${h[4].slice(0, 90)}` : "?";
        const k = `${what}|${m[1]}|${m[2]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        console.log(`${t} DELIVER via=${via} ${m[1]} r${m[2]} ${what}`);
      }
    }
    if (e.type === "assistant") for (const b of e.message?.content ?? [])
      if (b.type === "tool_use" && typeof b.input?.command === "string" && !/<<\s*\'?EOF/.test(b.input.command) && SELF.test(b.input.command))
        console.log(`${t} SELF ${b.input.command.replace(/\s+/g, " ").slice(0, 220)}`);
  }
}
