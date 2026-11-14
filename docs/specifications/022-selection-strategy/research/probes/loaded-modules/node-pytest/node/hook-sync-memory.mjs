// Throwaway probe: like hook-sync.mjs but resolve-only, kept in memory and
// written once at exit to $LM_OUT/<pid>-<threadId>.txt (one URL per line).
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { threadId, isInternalThread } from "node:worker_threads";
const out = process.env.LM_OUT;
if (out && !isInternalThread && typeof registerHooks === "function") {
  const seen = new Set();
  registerHooks({ resolve(s, c, next) { const r = next(s, c); seen.add(r.url); return r; } });
  process.on("exit", () => { if (seen.size) writeFileSync(`${out}/${process.pid}-${threadId}.txt`, [...seen].join("\n")); });
}
