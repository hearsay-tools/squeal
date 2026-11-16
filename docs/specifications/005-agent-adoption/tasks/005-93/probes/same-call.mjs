// Throwaway probe for the 005-93 design note. Read-only on a Squeal store and Claude Code transcripts.
// Usage: node same-call.mjs <store.sqlite> > out.jsonl
// For each Edit/Write/MultiEdit call in a live worktree's transcripts: when the tool returned,
// when the revision that recorded the file was written, and the next delivered PostToolBatch
// message (its start = finish - durationMs, and the revision its header names).
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const projects = join(process.env.HOME, ".claude", "projects");
const revsOf = db.prepare("select number n, created_at t, changes from revisions where worktree_id = ? order by number");
for (const w of db.prepare("select id, root from worktrees").all()) {
  const dir = join(projects, w.root.replace(/[/.]/g, "-"));
  if (!existsSync(dir)) continue;
  const revs = revsOf.all(w.id).map((r) => ({ n: r.n, t: r.t, paths: new Set(JSON.parse(r.changes).map((c) => c.path)) }));
  if (revs.length === 0) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const uses = new Map();
    const hooks = [];
    for (const l of lines) {
      const content = l.message?.content;
      if (Array.isArray(content)) for (const c of content) {
        if (c.type === "tool_use" && ["Edit", "Write", "MultiEdit"].includes(c.name) && typeof c.input?.file_path === "string") uses.set(c.id, { path: c.input.file_path });
        if (c.type === "tool_result" && uses.has(c.tool_use_id)) uses.get(c.tool_use_id).done = Date.parse(l.timestamp);
      }
      const a = l.attachment;
      if (a?.type === "hook_success" && a.hookEvent === "PostToolBatch") {
        const m = /SQUEAL[^\n]*\n(?:Revision|revision) (\d+)/.exec(a.stdout ?? "") ?? /at revision (\d+)/.exec(a.stdout ?? "");
        hooks.push({ end: Date.parse(l.timestamp), ms: a.durationMs ?? null, rev: m ? Number(m[1]) : null });
      }
    }
    for (const u of uses.values()) {
      if (u.done === undefined || !u.path.startsWith(w.root + "/")) continue;
      const rel = relative(w.root, u.path);
      const rev = revs.find((r) => r.t >= u.done - 2000 && r.paths.has(rel));
      if (!rev || rev.t - u.done > 60000) continue;
      const hook = hooks.find((h) => h.end >= u.done);
      const hookNext = hook && hook.end - u.done < 120000 ? hook : null;
      console.log(JSON.stringify({ w: w.id.slice(0, 8), lag: rev.t - u.done, rev: rev.n,
        hook: hookNext && { start: hookNext.ms === null ? null : hookNext.end - hookNext.ms - u.done, end: hookNext.end - u.done, named: hookNext.rev } }));
    }
  }
}
