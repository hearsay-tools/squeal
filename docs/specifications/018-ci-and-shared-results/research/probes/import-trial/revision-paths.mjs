import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const tracked = new Set(readFileSync("tracked.txt","utf8").split("\n"));
const db = new DatabaseSync("storecopy/store.sqlite", { readOnly: true });
const m = new Map();
for (const r of db.prepare("select worktree_id w, trigger t, changes c from revisions").iterate()) {
  for (const ch of JSON.parse(r.c)) {
    const k = ch.path; const e = m.get(k) ?? {n:0, wts:new Set(), ign:0, add:0, del:0, trig:{}};
    e.n++; e.wts.add(r.w); if (ch.ignored) e.ign++; if (ch.oldHash===null) e.add++; if (ch.newHash===null) e.del++;
    e.trig[r.t]=(e.trig[r.t]??0)+1; m.set(k,e);
  }
}
const rows=[...m].filter(([p])=>!tracked.has(p)).sort((a,b)=>b[1].wts.size-a[1].wts.size).slice(0,100000);
for (const [p,e] of rows) console.log(e.wts.size, e.n, `ign=${e.ign} add=${e.add} del=${e.del}`, JSON.stringify(e.trig), p);
