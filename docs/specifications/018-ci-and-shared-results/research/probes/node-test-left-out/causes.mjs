// Throwaway probe (row 018-55). Gives each left-out (file, input) pair one cause, then
// per file its causes and test seconds. Usage:
//   node causes.mjs <pairs.json> <checkout> <part-dir>... > causes.tsv   (summary on stderr)
import { readFileSync, readdirSync } from "node:fs";
import { join, matchesGlob } from "node:path";

const [pairsFile, checkout, ...dirs] = process.argv.slice(2);
const pairs = JSON.parse(readFileSync(pairsFile, "utf8"));
const config = JSON.parse(readFileSync(join(checkout, "squeal.config.json"), "utf8"));
const seconds = new Map();
for (const dir of dirs)
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".json")))
    for (const f of JSON.parse(readFileSync(join(dir, n), "utf8")).testFiles) seconds.set(f.path, f.durationMs / 1000);

// node:path matchesGlob skips dot segments under **; Squeal globs match them, so hide the dots.
const undot = (p) => p.replace(/(^|\/)\./g, "$1_");
const declared = (file, input) =>
  Object.entries(config.inputs ?? {}).some(
    ([tests, globs]) => matchesGlob(file, tests) && globs.some((g) => matchesGlob(undot(input), undot(g))),
  );
const STRING_REQUIRE = /^(\.github\/scripts\/word\.cjs|scripts\/hub\.ts)(\.\w+)?$|^scripts\/package\.json$/;

function cause(p) {
  if (p.input.includes("?")) return "graph:query-specifier";
  if (STRING_REQUIRE.test(p.input)) return "graph:require-in-string";
  if (p.input === "packages/contract/tsconfig.json") return "graph:tsconfig-tsx-never-reads";
  if (p.input === "packages/cezar/src/core/runner-skill-catalog.ts") return "graph:import-used-as-type";
  if (declared(p.testFile, p.input)) {
    if (p.here.kind === "untracked") return "declared:path-through-symlink";
    if (p.othersEqual.length > 0) return "declared:read-only-in-other-runs";
    return "declared:read-by-nothing-hooked";
  }
  return "other";
}

const perFile = new Map();
const perCause = new Map();
for (const p of pairs) {
  const c = cause(p);
  const f = perFile.get(p.testFile) ?? { project: p.project, causes: new Map() };
  f.causes.set(c, (f.causes.get(c) ?? 0) + 1);
  perFile.set(p.testFile, f);
  perCause.set(c, (perCause.get(c) ?? 0) + 1);
}
const rows = ["project\ttest file\tseconds\tcauses (pairs)"];
const only = new Map();
const any = new Map();
const familyOnly = new Map();
for (const [file, { project, causes }] of [...perFile].sort()) {
  const s = seconds.get(file) ?? 0;
  rows.push(`${project}\t${file}\t${s.toFixed(1)}\t${[...causes].map(([c, n]) => `${c} (${n})`).join(", ")}`);
  const key = [...causes.keys()].sort().join(" + ");
  const o = only.get(key) ?? { files: 0, s: 0 };
  only.set(key, { files: o.files + 1, s: o.s + s });
  for (const c of causes.keys()) {
    const a = any.get(c) ?? { files: 0, s: 0 };
    any.set(c, { files: a.files + 1, s: a.s + s });
  }
  const fam = [...new Set([...causes.keys()].map((c) => c.split(":")[0]))].sort().join(" + ");
  const fo = familyOnly.get(fam) ?? { files: 0, s: 0 };
  familyOnly.set(fam, { files: fo.files + 1, s: fo.s + s });
}
process.stdout.write(rows.join("\n") + "\n");
const show = (title, m) => {
  console.error(`\n${title}`);
  for (const [k, v] of [...m].sort((a, b) => (b[1].files ?? b[1]) - (a[1].files ?? a[1])))
    console.error(typeof v === "number" ? `  ${v}\t${k}` : `  ${v.files} files\t${v.s.toFixed(1)} s\t${k}`);
};
show("pairs per cause", perCause);
show("files per exact cause set", only);
show("files having the cause (overlapping)", any);
show("files per cause family set", familyOnly);
