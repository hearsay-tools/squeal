// Throwaway probe (017-01). For each mutation, a fresh `key.mjs` process before
// and after: does the computed config move when the findings move?
// Usage: node cases.mjs <project root>
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mutations } from "./mutations.mjs";

const root = process.argv[2];
const key = fileURLToPath(new URL("./key.mjs", import.meta.url));
const facts = (files) => JSON.parse(execFileSync("node", [key, root, ...files], { encoding: "utf8" }));

const rows = [];
for (const m of mutations(root)) {
  const before = facts(m.files);
  m.apply();
  let after;
  try { after = facts(m.files); } finally { m.revert(); }
  for (const f of m.files) {
    const b = before.files[f], a = after.files[f];
    const configMoved = b.configHash !== a.configHash || b.ignored !== a.ignored;
    const findingsMoved = JSON.stringify(b.findings) !== JSON.stringify(a.findings);
    rows.push({ id: m.id, file: f, typed: b.typed ?? false, configMoved, findingsMoved,
      verdict: findingsMoved && !configMoved ? "MISSED by config key" : findingsMoved ? "caught" : configMoved ? "over-keyed" : "no change",
      added: a.findings.filter((x) => !b.findings.includes(x)), removed: b.findings.filter((x) => !a.findings.includes(x)) });
  }
}
console.log(`ESLint ${facts(["src/a.js"]).eslint}`);
for (const r of rows) console.log(JSON.stringify(r));
