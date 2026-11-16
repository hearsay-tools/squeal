// Throwaway probe for the 005-93 design note: settled lines delivered to the live worktrees of a
// store (their Claude Code transcripts), beside settles.mjs's moments for the same worktrees.
// Usage: node settled-per-worktree.mjs <store.sqlite> <edits.jsonl>
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = readFileSync(process.argv[3], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.ran.length > 0);
const live = new Set(rows.map((r) => r.w));
const projects = join(process.env.HOME, ".claude", "projects");
let settled = 0, messages = 0, found = 0;
for (const w of db.prepare("select id, root from worktrees").all()) {
  if (!live.has(w.id.slice(0, 8))) continue;
  const dir = join(projects, w.root.replace(/[/.]/g, "-"));
  if (!existsSync(dir)) continue;
  found++;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.includes("hook_additional_context") || !line.includes("PostToolBatch")) continue;
      const a = JSON.parse(line).attachment;
      if (a?.type !== "hook_additional_context") continue;
      const text = (a.content ?? []).join("\n");
      messages++;
      if (/re-keyed (?:is|are) current\.|re-keyed finished:|Squeal saw your edit; (?:the 1|all \d+|of the)/.test(text)) settled++;
    }
  }
}
console.log("worktrees with edits", live.size, "with transcripts", found, "PostToolBatch messages", messages, "settled lines", settled);
