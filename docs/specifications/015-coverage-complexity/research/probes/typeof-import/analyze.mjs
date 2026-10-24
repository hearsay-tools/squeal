// Throwaway probe (015-25). Summarises measure.mjs's output: node analyze.mjs <out.json> [--list]
import { readFileSync } from "node:fs";
const { root, timing, files } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const list = process.argv.includes("--list");
const ways = ["shipped", "r1", "r2", "r3", "pr375"];
const diffIds = (a, b) => {
  const A = new Set(a), B = new Set(b);
  return a.filter((x) => !B.has(x)).length + b.filter((x) => !A.has(x)).length;
};
const agrees = (f, w) => !f.eslint.fatal && f[w].ccs === f.eslint.ccs;
function report(name, set) {
  const row = { files: set.length, withTypeofImport: set.filter((f) => f.has).length, eslintFatal: set.filter((f) => f.eslint.fatal).length };
  row.table = Object.fromEntries(ways.map((w) => [w, {
    filesWithErrors: set.filter((f) => f[w].errors > 0).length,
    functionsInError: set.reduce((n, f) => n + f[w].inError, 0),
    functions: set.reduce((n, f) => n + f[w].functions, 0),
    filesAgreeingWithEslint: set.filter((f) => agrees(f, w)).length,
    idsDifferFromShipped: set.reduce((n, f) => n + diffIds(f.shipped.ids, f[w].ids), 0),
    filesChanged: w === "shipped" || w === "pr375" ? null : set.filter((f) => f.changed[w]).length,
    sites: w === "shipped" || w === "pr375" ? null : set.flatMap((f) => f.sites[w]).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}),
  }]));
  row.eslintFunctions = set.reduce((n, f) => n + f.eslint.functions, 0);
  row.pr375TreeDiffers = { withTypeofImport: set.filter((f) => f.has && !f.pr375TreeSame).length, other: set.filter((f) => !f.has && !f.pr375TreeSame).map((f) => f.path) };
  row.silentMisparse = set.filter((f) => !f.pr375TreeSame && f.shipped.errors === 0).map((f) => f.path);
  row.own0232TreeDiffers = set.filter((f) => !f.own0232TreeSame).length;
  console.log(`## ${name}\n${JSON.stringify(row.table ? { ...row, table: undefined } : row)}`);
  console.log("| way | files with errors | functions in errors | functions | files agreeing with ESLint | function ids changed vs shipped | files rewritten | rewritten sites |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const [w, r] of Object.entries(row.table))
    console.log(`| ${w} | ${r.filesWithErrors} | ${r.functionsInError} | ${r.functions} | ${r.filesAgreeingWithEslint} | ${r.idsDifferFromShipped} | ${r.filesChanged ?? "-"} | ${r.sites ? JSON.stringify(r.sites) : "-"} |`);
  if (list) {
    for (const f of set) {
      const bad = ways.filter((w) => f[w].errors > 0 || !agrees(f, w));
      if (bad.length) console.log(`  ${f.path} typeofImport=${f.has} errors/inError=${ways.map((w) => `${w}:${f[w].errors}/${f[w].inError}`).join(",")} eslintDisagree=[${ways.filter((w) => !agrees(f, w))}] eslint=${f.eslint.functions} fatal=${f.eslint.fatal ?? "-"}`);
    }
  }
}
console.log(`# ${root}\n${JSON.stringify(timing)}`);
report("all files (015-23's filter)", files);
report("not test-named (the included set, approximated)", files.filter((f) => !f.test));
report("test-named", files.filter((f) => f.test));
