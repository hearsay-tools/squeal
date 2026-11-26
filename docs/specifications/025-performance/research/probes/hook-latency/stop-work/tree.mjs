// tree.mjs <dir> <root-regex> [depth] [minMs]: mean inclusive call tree below frames matching root.
import { readFileSync, readdirSync } from "node:fs";
const [dir, rootRe, depthS = "4", minS = "0.2"] = process.argv.slice(2);
const re = new RegExp(rootRe), maxDepth = Number(depthS), min = Number(minS);
const files = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
const tree = { ms: 0, kids: new Map() };
for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const label = (x) => `${x.callFrame.functionName || "(anon)"} ${x.callFrame.url.split("/").pop()}:${x.callFrame.lineNumber}`;
  for (let i = 0; i < p.samples.length; i++) {
    const ms = (p.timeDeltas[i + 1] ?? 0) / 1000 / files.length;
    const path = [];
    for (let cur = p.samples[i]; cur !== undefined; cur = parent.get(cur)) path.unshift(label(byId.get(cur)));
    const at = path.findIndex((l) => re.test(l));
    if (at < 0) continue;
    let node = tree; node.ms += ms;
    for (const l of path.slice(at, at + maxDepth + 1)) {
      if (!node.kids.has(l)) node.kids.set(l, { ms: 0, kids: new Map() });
      node = node.kids.get(l); node.ms += ms;
    }
  }
}
const show = (n, ind) => { for (const [l, k] of [...n.kids].sort((a, b) => b[1].ms - a[1].ms)) { if (k.ms < min) continue; console.log(`${ind}${k.ms.toFixed(2)} ${l}`); show(k, ind + "  "); } };
show(tree, "");
