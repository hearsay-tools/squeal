// Throwaway (row 021-04): compare what the runner answered on two roots (local, remote).
// Usage: node compare-env.mjs a.jsonl b.jsonl
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const [a, b] = process.argv.slice(2).map(read);
const pick = (rows, step) => rows.find((r) => r.step === step);
const ea = pick(a, "list").environment, eb = pick(b, "list").environment;
console.log("roots:", pick(a, "start").hello.root, "|", pick(b, "start").hello.root);
console.log("environment() equal:", JSON.stringify(ea) === JSON.stringify(eb));
for (let i = 0; i < ea.length; i++) {
  for (const k of Object.keys(ea[i])) {
    if (JSON.stringify(ea[i][k]) !== JSON.stringify(eb[i][k])) console.log(" differs:", ea[i].project, k);
  }
  const ca = JSON.parse(ea[i].resolvedConfig), cb = JSON.parse(eb[i].resolvedConfig);
  const walk = (x, y, p) => {
    if (typeof x === "object" && x && y && typeof y === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${k}`);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) console.log("  config", p, JSON.stringify(x), "!=", JSON.stringify(y));
  };
  walk(ca, cb, "");
  const abs = ea[i].resolvedConfig.match(/"\/[^"]*"/g) ?? [];
  console.log(" absolute strings left in resolvedConfig:", abs.length, abs.slice(0, 5).join(" "));
}
const ra = pick(a, "edit"), rb = pick(b, "edit");
console.log("closure bytes equal:", ra.closureBytes === rb.closureBytes, "affected equal:", JSON.stringify(ra.affected) === JSON.stringify(rb.affected));
console.log("observed equal:", JSON.stringify(ra.observed) === JSON.stringify(rb.observed));
console.log("outcomes:", ra.outcomes.join(","), "|", rb.outcomes.join(","));
