// Throwaway, read-only: prints a timeline of one Claude Code transcript (.jsonl):
// user prompts, Bash commands, and every text block that carries "SQUEAL" or names a
// .e2e.ts file, from tool results, hook output and attachments.
// Usage: node timeline.mjs <transcript.jsonl> [filter-regex]
import { readFileSync } from "node:fs";

const [file, filter] = process.argv.slice(2);
const re = filter ? new RegExp(filter) : null;
const clip = (s, n = Number(process.env.CLIP ?? 600)) => (s.length > n ? s.slice(0, n) + ` …[+${s.length - n}]` : s);
const texts = (v) => {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (typeof v === "object") return [v.text, v.content, v.stdout, v.stderr].flatMap(texts);
  return [];
};
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  const t = (e.timestamp ?? "").slice(11, 19);
  const out = [];
  const msg = e.message;
  if (e.type === "user" && msg) {
    const c = msg.content;
    if (typeof c === "string") out.push(["USER", c]);
    else for (const b of c ?? []) {
      if (b.type === "text") out.push(["USER", b.text]);
      if (b.type === "tool_result") for (const s of texts(b.content)) if (/SQUEAL|\.e2e\.ts|squeal run|vitest/.test(s)) out.push(["RESULT", s]);
    }
  }
  if (e.type === "assistant" && msg) for (const b of msg.content ?? []) {
    if (b.type === "tool_use" && b.input?.command) out.push(["BASH", b.input.command]);
    if (b.type === "text" && /\.e2e\.ts|squeal|slow/i.test(b.text)) out.push(["SAY", b.text]);
  }
  if (e.attachment) for (const s of texts(e.attachment)) if (/SQUEAL/.test(s)) out.push(["HOOK:" + (e.attachment.hookEvent ?? e.attachment.type), s]);
  for (const [k, s] of out) if (!re || re.test(s)) console.log(`${t} ${k} ${clip(s.replace(/\s+/g, " "))}`);
}
