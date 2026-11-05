// 011-299 probe (throwaway): class (b), content new on this host. For each such file run, the nearest stored
// content (classes.cjs `nearest`: the clean commit with the fewest closure paths changed): how many paths, which,
// and whether a hub file (in >= 50% of server closures) is among them; split by start commit on origin/main or not.
// Usage: node newcontent.cjs <store copy> <classes.jsonl> <classes.cls.jsonl> <starts.jsonl>
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const [, , storePath, rawPath, clsPath, startsPath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const read = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const R = read(rawPath), C = read(clsPath), ST = new Map(read(startsPath).map((s) => [s.ck, s]));
const cl = db.prepare("select closure_paths from test_files where project = 'server'").all().map((r) => JSON.parse(r.closure_paths));
const cnt = new Map(); for (const c of cl) for (const p of c) cnt.set(p, (cnt.get(p) ?? 0) + 1);
const hub = new Set([...cnt].filter(([, n]) => n >= 0.5 * cl.length).map(([p]) => p));
const S = {}, paths = new Map(), ns = [];
const add = (k, s) => (S[k] = (S[k] ?? 0) + s);
R.forEach((r, i) => {
  if (!C[i].c.startsWith("b  ")) return;
  const st = ST.get(r.ck); const where = st?.onMain ? "start on main" : "start on a branch commit";
  const dirty = r.ownDirty === "unknown" ? "dirty-unknown" : "known";
  add(`${dirty} ${where}`, r.sec);
  const nb = r.nearest; if (!nb) { add("no nearest", r.sec); return; }
  ns.push([nb.n, r.sec]);
  const hubHit = nb.paths.some((p) => hub.has(p));
  add(`${dirty} nearest differs in a hub file: ${hubHit}`, r.sec);
  add(`nearest differs in ${nb.n === 1 ? "1 path" : nb.n <= 5 ? "2-5 paths" : nb.n <= 20 ? "6-20 paths" : ">20 paths"}`, r.sec);
  if (nb.paths.some((p) => /pnpm-lock|vitest\.|squeal\.config|pnpm-workspace/.test(p))) add("nearest differs in a runner or lock file", r.sec);
  for (const p of nb.paths) paths.set(p, (paths.get(p) ?? 0) + r.sec / nb.paths.length);
});
console.log(`hub files: ${hub.size}`);
for (const [k, v] of Object.entries(S).sort()) console.log(String(Math.round(v)).padStart(7), k);
console.log("top paths of the nearest difference (seconds split across a run's paths):");
console.log([...paths].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, s]) => `${String(Math.round(s)).padStart(7)} ${hub.has(p) ? "hub " : "    "}${p}`).join("\n"));
