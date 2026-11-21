// Throwaway (row 018-72): the parts in which two or more environment descriptors differ
// (squawk store, read-only). Usage: node env-pair.mjs <hashPrefix> <hashPrefix>...
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) { if (k === "files" && Array.isArray(v)) { for (const [f, h] of v) out[`files:${f}`] = String(h).slice(0, 10); continue; } if (v && typeof v === "object" && !Array.isArray(v)) flat(v, p + k + ".", out); else out[p + k] = JSON.stringify(v).slice(0, 70); } return out; };
const ds = process.argv.slice(2).map((h) => { const r = db.prepare("select hash, descriptor d, recorded_at t from environments where hash like ?").get(h + "%"); return { h: r.hash.slice(0, 10), t: new Date(r.t).toISOString(), f: flat(JSON.parse(r.d)) }; });
console.log(ds.map((d) => `${d.h} first recorded ${d.t}`).join("\n"));
for (const k of new Set(ds.flatMap((d) => Object.keys(d.f)))) { const vals = ds.map((d) => d.f[k] ?? "-"); if (new Set(vals).size > 1) console.log(k.padEnd(70), vals.join("  ")); }
