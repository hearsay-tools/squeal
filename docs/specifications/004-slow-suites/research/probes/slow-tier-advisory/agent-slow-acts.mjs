// Throwaway, read-only: per Claude Code transcript with a Squeal slow tier, which slow instruction
// the primer carried and what the agent ran itself. Usage: node agent-slow-acts.mjs <transcript.jsonl>...
// Only transcripts with a SQUEAL registration. Columns: date, version (from the SQUEAL primer's run line when present), primer variant
// ("before-done": tells every repository to run `squeal run --slow` before done; "policy": reads
// the Slow tier line's policy), edits (revisions seen), agent's `squeal run --slow` / `run --all`
// commands, edits (Edit/Write tool uses plus sed -i / python heredoc / redirect writes), npm/pnpm e2e or test:package runs, slow deliveries received.
import { readFileSync } from "node:fs";

for (const file of process.argv.slice(2)) {
  const s = readFileSync(file, "utf8");
  if (!s.includes("Slow tier:")) continue;
  let date = "", runSlow = 0, runAll = 0, npmE2e = 0, maxRev = 0, edits = 0;
  if (!s.includes("SQUEAL \u00b7 registered")) continue;
  const variant = /before you say the task is done, run `squeal run --slow/.test(s) ? "before-done" : /does not require them before you finish|slow tier is not required/.test(s) ? "policy" : "other";
  for (const line of s.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!date && e.timestamp) date = e.timestamp.slice(0, 10);
    if (e.type !== "assistant") continue;
    for (const b of e.message?.content ?? []) {
      if (b.type === "tool_use" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) edits++;
      const c = b.type === "tool_use" ? b.input?.command : null;
      if (typeof c === "string" && /sed -i|python3 - <<|> [a-z./]+\.(ts|tsx|md)\b/.test(c)) edits++;
      if (typeof c !== "string" || /<<\s*'?EOF/.test(c)) continue;
      if (/squeal run [^|;&]*--slow/.test(c)) runSlow++;
      else if (/squeal run [^|;&]*--all/.test(c)) runAll++;
      if (/(npm|pnpm)( run)? (test:e2e|test:package|e2e)\b|vitest[^|;&]*e2e\/vitest\.config/.test(c)) npmE2e++;
    }
  }
  for (const m of s.matchAll(/at revision (\d+)/g)) maxRev = Math.max(maxRev, +m[1]);
  const deliveries = new Set([...s.matchAll(/(PASS -> FAIL|first observed: FAIL), slow tier, Squeal's run saw it at revision (\d+)/g)].map((m) => m[0])).size;
  console.log([date, variant, `rev<=${maxRev}`, `edits=${edits}`, `runSlow=${runSlow}`, `runAll=${runAll}`, `npmE2e=${npmE2e}`, `slowDeliveries=${deliveries}`, file.replace(/.*projects\//, "")].join(" "));
}
