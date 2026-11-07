import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare("select key, value from meta where key like 'observed%'").all()) {
  let v; try { v = JSON.parse(r.value); } catch { continue; }
  const bad = Object.entries(v).filter(([, ps]) => Array.isArray(ps) && ps.some((p) => p.includes("\\")));
  if (bad.length) console.log(r.key, bad.map(([t, ps]) => `${t}: ${ps.filter((p) => p.includes("\\")).length}`));
}
const notes = db.prepare("select key, value from meta where key like 'notes.%' and instr(value, 'expected a worktree-relative path') > 0").all();
let exits = 0, first = Infinity, last = 0; const wts = new Set();
for (const n of notes) for (const e of JSON.parse(n.value)) if (e.text.includes("expected a worktree-relative path")) { exits++; wts.add(n.key); first = Math.min(first, e.at); last = Math.max(last, e.at); }
console.log({ worktrees: wts.size, notes: exits, first: new Date(first).toISOString(), last: new Date(last).toISOString() });
