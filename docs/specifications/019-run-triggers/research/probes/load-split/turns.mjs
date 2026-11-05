// 019-46 probe (throwaway): agent turn ends (Stop), turn starts and file edits per Squeal worktree id,
// from Claude Code and Codex transcripts. Usage: node turns.mjs <since ISO> <out.json>
// Worktree id = sha256(realpath(root)).slice(0,16) (src/core/fs/git-layout.ts). Reads transcripts only.
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, relative } from "node:path";
const [, , sinceIso, out] = process.argv;
const since = Date.parse(sinceIso);
const HOME = process.env.HOME;
const idOf = (p) => createHash("sha256").update(p).digest("hex").slice(0, 16);
const rootOf = (cwd) => {
  const m = cwd.match(/^(.*?\/\.ai\/cezar\/worktrees\/[^/]+)/) ?? cwd.match(/^(\/home\/agent\/projects\/[^/]+)/);
  if (!m) return cwd;
  try { return realpathSync(m[1]); } catch { return m[1]; }
};
const W = new Map(); // id -> {root, stops:[], starts:[], edits:[[t,path]], sessions:Set}
const wt = (root) => { const id = idOf(root); if (!W.has(id)) W.set(id, { root, stops: [], starts: [], edits: [], sessions: new Set() }); return W.get(id); };
function* walk(dir) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) { const p = join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith(".jsonl")) yield p; }
}
const files = [];
for (const f of walk(join(HOME, ".claude/projects"))) { try { if (statSync(f).mtimeMs >= since) files.push(["claude", f]); } catch {} }
for (const f of walk(join(HOME, ".codex/sessions"))) { try { if (statSync(f).mtimeMs >= since) files.push(["codex", f]); } catch {} }
let lines = 0;
for (const [kind, f] of files) {
  const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
  let codexRoot = null; const sidechainFile = f.includes("/subagents/");
  for await (const line of rl) {
    lines++;
    if (kind === "claude") {
      const stop = line.includes('"stop_hook_summary"'); const tool = line.includes('"tool_use"'); const user = line.startsWith('{"parentUuid') && line.includes('"type":"user"');
      if (!stop && !tool && !user) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!e.cwd || !e.timestamp) continue;
      const t = Date.parse(e.timestamp); if (t < since) continue;
      const root = rootOf(e.cwd); const w = wt(root); w.sessions.add(e.sessionId);
      const side = sidechainFile || e.isSidechain;
      if (stop && e.type === "system" && !side) w.stops.push(t);
      else if (e.type === "user" && !side) {
        const c = e.message?.content;
        const prompt = typeof c === "string" || (Array.isArray(c) && c.some((x) => x.type === "text") && !c.some((x) => x.type === "tool_result"));
        if (prompt && !e.isMeta) w.starts.push(t);
      } else if (e.type === "assistant") {
        for (const c of e.message?.content ?? []) if (c.type === "tool_use" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name)) {
          const p = c.input?.file_path ?? c.input?.notebook_path; if (p && p.startsWith(root + "/")) w.edits.push([t, relative(root, p)]);
        }
      }
    } else {
      if (!/session_meta|task_started|task_complete|Begin Patch|turn_context/.test(line)) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const t = Date.parse(e.timestamp);
      if (e.type === "session_meta" || e.type === "turn_context") { const cwd = e.payload?.cwd; if (cwd) codexRoot = rootOf(cwd); continue; }
      if (!codexRoot || t < since) continue;
      const w = wt(codexRoot);
      const pt = e.payload?.type;
      if (pt === "task_complete") w.stops.push(t);
      else if (pt === "task_started") w.starts.push(t);
      else if (e.type === "response_item" && /call$/.test(pt ?? "")) {
        // apply_patch called directly or from an exec script: every "*** Update/Add/Delete File:" line
        const text = (typeof e.payload.input === "string" ? e.payload.input : String(e.payload.arguments ?? "")).replace(/\\n/g, "\n");
        for (const m of text.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\]+)/g)) {
          const p = m[1].trim(); w.edits.push([t, p.startsWith("/") ? relative(codexRoot, p) : p]);
        }
      }
    }
  }
}
const obj = {};
for (const [id, w] of W) { w.stops.sort((a, b) => a - b); w.starts.sort((a, b) => a - b); w.edits.sort((a, b) => a[0] - b[0]); obj[id] = { ...w, sessions: [...w.sessions].length }; }
writeFileSync(out, JSON.stringify({ since: sinceIso, files: files.length, lines, worktrees: obj }));
console.log(files.length, "files", lines, "lines", W.size, "worktrees");
