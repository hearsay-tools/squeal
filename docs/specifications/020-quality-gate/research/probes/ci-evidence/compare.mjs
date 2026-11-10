// Throwaway probe for research/ci-evidence.md, Q2: per test file, whether the
// record mapped in the project's Vitest (hook) equals the gate collector's.
// Usage: node compare.mjs <hook records dir> <gate records dir>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [hookDir, gateDir] = process.argv.slice(2);
const names = new Set([...readdirSync(hookDir), ...readdirSync(gateDir)]);
const rows = [];
for (const name of [...names].sort()) {
  const read = (dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      return null;
    }
  };
  const a = read(hookDir);
  const b = read(gateDir);
  if (a === null || b === null) {
    rows.push({ file: name, equal: false, why: a === null ? "no hook record" : "no gate record" });
    continue;
  }
  const equal = JSON.stringify(a) === JSON.stringify(b);
  const why = equal
    ? ""
    : (() => {
        const pa = new Map(a.sources.map((s) => [s.path, s]));
        const pb = new Map(b.sources.map((s) => [s.path, s]));
        const diff = [];
        for (const p of new Set([...pa.keys(), ...pb.keys()])) {
          const x = pa.get(p);
          const y = pb.get(p);
          if (!x || !y) diff.push(`${p}: only in ${x ? "hook" : "gate"}`);
          else if (JSON.stringify(x) !== JSON.stringify(y)) {
            const fields = ["blob", "lines", "covered", "functions"].filter((f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]));
            diff.push(`${p}: ${fields.join(",")}`);
          }
        }
        if (JSON.stringify(a.unread) !== JSON.stringify(b.unread)) diff.push(`unread ${JSON.stringify(a.unread)} vs ${JSON.stringify(b.unread)}`);
        return diff.join("; ");
      })();
  rows.push({ file: name, equal, why });
}
const equal = rows.filter((r) => r.equal).length;
console.log(JSON.stringify({ files: rows.length, equal, differ: rows.filter((r) => !r.equal) }, null, 1));
