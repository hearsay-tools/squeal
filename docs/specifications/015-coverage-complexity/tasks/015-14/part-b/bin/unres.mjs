// 015-14 part B: the unknown functions of judged files (R6 residue), by the shape of their stored detail.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const O = "/tmp/dogfood-015-14/w-327524f0/out/";
const summ = new Map(JSON.parse(readFileSync(O + "summaries.json", "utf8")).map((r) => [r.wt, JSON.parse(r.value)]));
const db = new DatabaseSync("/home/agent/projects/squeal/.git/squeal/code.sqlite", { readOnly: true });
const rows = db.prepare(`select s.worktree_id wt, c.path, c.qualified_name q, c.occurrence o from states s join checks c on c.id = s.check_id
  where s.measure = 'uncovered' and s.outcome = 'unknown'`).all();
const meta = db.prepare("select value from meta where key = ?");
const cache = new Map();
const shape = {};
const examples = {};
let judged = 0;
for (const r of rows) {
  const f = summ.get(r.wt)?.files[r.path];
  if (!f || f.state !== "judged") continue;
  judged++;
  const key = `coverage:${r.wt}:${r.path}`;
  if (!cache.has(key)) cache.set(key, JSON.parse(meta.get(key)?.value ?? "null"));
  const d = cache.get(key)?.functions?.[`${r.q}\u0000${r.o}`];
  const k = d === undefined ? "no detail" : d[0] <= 1 ? `one line, ${d[1]} covered, ${d[2]} test files` : `${d[0] > 1 ? "several lines" : ""}, covered ${d[1] > 0 ? ">0" : "0"}, test files ${d[2] > 0 ? ">0" : "0"}`;
  shape[k] = (shape[k] ?? 0) + 1;
  const ext = r.path.replace(/^.*\./, ""); shape["ext " + ext] = (shape["ext " + ext] ?? 0) + 1;
  if (r.wt === "95f8346992f91e4f") shape["52e58f23 " + k] = (shape["52e58f23 " + k] ?? 0) + 1;
  (examples[k] ??= []).length < 4 && examples[k].push(`${r.path} ${r.q}#${r.o} ${JSON.stringify(d)}`);
}
console.log(JSON.stringify({ judged, shape, examples }, null, 1));
