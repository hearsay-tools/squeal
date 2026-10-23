// 011-152 probe (throwaway): how long the missed content had been in git before the start: walk the miss commit's first-parent ancestry back
// while the file's closure content stays equal; the oldest such commit is where that content first stood on this line.
// Usage: node age.mjs <store copy> <content.jsonl> <git dir> <out.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto";
const [, , storePath, contentPath, gitDir, outPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const misses = readFileSync(contentPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.X && m.Xdirty === 0);
const closures = new Map(db.prepare("SELECT project, path, closure_paths FROM test_files").all().map((t) => [t.project + "\0" + t.path, JSON.parse(t.closure_paths)]));
const observed = new Map();
for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) for (const [t, ps] of Object.entries(JSON.parse(m.value))) observed.set(m.key.slice(9) + "\0" + t, ps);
const glob = (g) => new RegExp("^" + g.split("**/").map((s) => s.split("**").map((x) => x.split("*").map((y) => y.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*")).join("(?:.*/)?") + "$");
const inputs = Object.entries(JSON.parse(readFileSync(gitDir + "/../squeal.config.json", "utf8")).inputs ?? {}).map(([k, v]) => [glob(k), v.map(glob)]);
const git = (...a) => execFileSync("git", ["--git-dir", gitDir, ...a], { maxBuffer: 1 << 28 }).toString().trim();
const trees = new Map();
function tree(c) { if (trees.has(c)) return trees.get(c); let m = null; try { m = new Map(git("ls-tree", "-r", "--full-tree", c).split("\n").map((l) => { const [meta, p] = l.split("\t"); return [p, meta.split(" ")[2]]; })); } catch {} trees.set(c, m); return m; }
function sig(file, c) {
  const t = tree(c); if (!t) return null; const path = file.split("\0")[1];
  const set = new Set([...(closures.get(file) ?? [path]), ...(observed.get(file) ?? [])]);
  for (const [re, gs] of inputs) if (re.test(path)) for (const q of t.keys()) if (gs.some((g) => g.test(q))) set.add(q);
  const h = createHash("sha256");
  for (const q of [...set].sort()) { if (q.endsWith("/") || q === "./") { const d = q === "./" ? "" : q; const names = new Set(); for (const k of t.keys()) if (k.startsWith(d)) names.add(k.slice(d.length).split("/")[0]); h.update(q + "\0" + [...names].sort().join("/") + "\0"); } else h.update(q + "\0" + (t.get(q) ?? "-") + "\0"); }
  return h.digest("hex");
}
const chains = new Map();
const chain = (x) => chains.get(x) ?? chains.set(x, git("rev-list", "--first-parent", "--format=%H %ct", "-n", "300", x).split("\n").filter((l) => !l.startsWith("commit ")).map((l) => { const [c, t] = l.split(" "); return { c, t: Number(t) * 1000 }; })).get(x);
const out = [];
for (const m of misses) {
  const s = sig(m.file, m.X); const ch = chain(m.X); let oldest = ch[0];
  for (const e of ch) { if (sig(m.file, e.c) !== s) break; oldest = e; }
  out.push({ w: m.w, live: m.live, ck: m.ck, ckStart: m.ckStart, file: m.file, ran: m.ran, secs: m.secs, X: m.X, cls: m.cls, since: oldest.c, sinceAt: oldest.t, ageMin: Math.round((m.ckStart - oldest.t) / 60000), xAgeMin: Math.round((m.ckStart - ch[0].t) / 60000) });
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const bucket = (a) => (a < 15 ? "<15 min" : a < 60 ? "15-60 min" : a < 360 ? "1-6 h" : ">6 h");
const by = {}; for (const o of out) { const k = `${o.cls} | content age ${bucket(o.ageMin)}`; by[k] ??= [0, 0]; by[k][0]++; by[k][1] += o.secs ?? 0; }
for (const [k, [n, s]] of Object.entries(by).sort()) console.log(`${Math.round(s)} s, ${n} misses: ${k}`);
