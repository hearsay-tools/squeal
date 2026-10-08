// Task 001-143 evidence, not product code. The call stacks under which a
// .cpuprofile spent self time in functions named <name>, by total time, with
// how many samples and the largest single run of consecutive samples.
// Usage: node stacks.mjs <file.cpuprofile> <name> [depth]
import { readFileSync } from "node:fs";
const [file, name, depth = "8"] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const label = (n) => `${n.callFrame.functionName || "(anon)"}@${n.callFrame.url.replace(/^.*node_modules\//, "nm/").replace(/^.*\//, "")}:${n.callFrame.lineNumber + 1}`;
const stacks = new Map();
p.samples.forEach((id, i) => {
  if (byId.get(id).callFrame.functionName !== name) return;
  const chain = [];
  for (let at = id; at !== undefined && chain.length < Number(depth); at = parent.get(at)) chain.push(label(byId.get(at)));
  const key = chain.join(" < ");
  const s = stacks.get(key) ?? { us: 0, n: 0 };
  s.us += p.timeDeltas[i] ?? 0; s.n++;
  stacks.set(key, s);
});
for (const [k, s] of [...stacks].sort((a, b) => b[1].us - a[1].us).slice(0, 8)) console.log(`${(s.us / 1000).toFixed(0)} ms, ${s.n} samples: ${k}\n`);
