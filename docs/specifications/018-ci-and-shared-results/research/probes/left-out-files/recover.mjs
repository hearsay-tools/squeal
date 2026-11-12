// Throwaway probe (row 018-40). Per left-out file: its causes, and which fixes would certify it.
// Usage: node recover.mjs <pairs.json from classify.mjs> <parts root>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [pairsFile, partsRoot] = process.argv.slice(2);
const pairs = JSON.parse(readFileSync(pairsFile, "utf8"));
const duration = new Map();
for (const dir of readdirSync(partsRoot).filter((d) => d.startsWith("squeal-parts-shard-"))) {
  for (const name of readdirSync(join(partsRoot, dir))) {
    const part = JSON.parse(readFileSync(join(partsRoot, dir, name), "utf8"));
    for (const f of part.testFiles) duration.set(`${f.project}:${f.path}`, f.durationMs ?? 0);
  }
}
// Causes, as established in left-out-files.md (classify.mjs + local runs).
const ARGUMENT = new Set([
  "packages/cezar/scripts/pi-retry-degraded-service.mjs",
  "packages/cezar/scripts/pi-project-skills.mjs",
  "packages/cezar/scripts/pi-default-tools.mjs",
  "sgconfig.yml",
]);
const SYMLINK_UNLINK = new Set(["packages/cezar/scripts/mock-cursor-print.mjs"]);
const cause = (x) => {
  if (x.readByFile && ARGUMENT.has(x.input)) return "argument";
  if (x.readByFile && SYMLINK_UNLINK.has(x.input)) return "symlink-unlink";
  if (x.readByFile) return "observed-other";
  if (x.here.kind === "missing" && x.input.includes("__snapshots__/")) return "absent-snapshot";
  if (x.here.kind === "missing") return "require-in-string";
  if (x.othersEqual.length > 0) return "never-loaded";
  return "native-reader-only";
};
const files = new Map();
for (const x of pairs) {
  if (!files.has(x.testFile)) files.set(x.testFile, new Set());
  files.get(x.testFile).add(cause(x));
}
const fixes = {
  A: ["argument"],
  B: ["symlink-unlink"],
  "A+B": ["argument", "symlink-unlink"],
  "A+B+cross-shard": ["argument", "symlink-unlink", "never-loaded"],
};
const combos = {};
for (const [, causes] of files) {
  const k = [...causes].sort().join("+");
  combos[k] = (combos[k] ?? 0) + 1;
}
const out = { files: files.size, combos, recovered: {} };
for (const [name, fixed] of Object.entries(fixes)) {
  const ok = [...files].filter(([, c]) => [...c].every((k) => fixed.includes(k)));
  out.recovered[name] = {
    files: ok.length,
    seconds: Math.round(ok.reduce((s, [f]) => s + duration.get(f), 0) / 1000),
  };
}
out.leftOutSeconds = Math.round([...files.keys()].reduce((s, f) => s + duration.get(f), 0) / 1000);
console.log(JSON.stringify(out, null, 1));
