// Throwaway probe (015-02), Q1: what each counter gives for one construct per function.
import { execFileSync } from "node:child_process";
import { viaTreeSitter, viaAcorn, viaOxc, viaEslint, viaEscomplex } from "./engines.mjs";
const VENV = process.env.VENV ?? "/tmp/r01502/venv";
const dir = new URL("./fixtures/", import.meta.url).pathname;

function lizard(path, lang) {
  const csv = execFileSync(`${VENV}/bin/lizard`, ["-l", lang, "--csv", path], { encoding: "utf8" });
  // NLOC,CCN,token,PARAM,length,location,file,function,long_name,start,end
  return csv.trim().split("\n").map((l) => l.match(/("[^"]*"|[^,]+)/g)).map((c) => ({ name: c[7].replaceAll('"', ""), line: Number(c[9]), cc: Number(c[1]) }));
}

function byLine(fns) { const m = new Map(); for (const f of fns) m.set(f.line, f); return m; }

const ts = `${dir}constructs.ts`;
const cols = {
  treesitter: viaTreeSitter(ts).fns, acorn: viaAcorn(ts).fns, oxc: viaOxc(ts).fns,
  eslint: viaEslint(ts).fns, escomplex: viaEscomplex(ts).fns, lizard: lizard(ts, "typescript"),
};
const rows = new Map();
for (const f of cols.treesitter) rows.set(f.line, f.name);
const header = ["line", "function", ...Object.keys(cols)];
console.log(`| ${header.join(" | ")} |\n|${header.map(() => " --- ").join("|")}|`);
const maps = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, byLine(v)]));
const lines = [...new Set(Object.values(cols).flatMap((v) => v.map((f) => f.line)))].sort((a, b) => a - b);
for (const l of lines) {
  const name = rows.get(l) ?? Object.values(maps).map((m) => m.get(l)?.name).find(Boolean);
  console.log(`| ${l} | ${name} | ${Object.keys(cols).map((k) => maps[k].get(l)?.cc ?? "-").join(" | ")} |`);
}

const py = `${dir}constructs.py`;
const radon = JSON.parse(execFileSync(`${VENV}/bin/radon`, ["cc", "-j", "-s", py], { encoding: "utf8" }))[py]
  .flatMap((b) => [b, ...(b.methods ?? []), ...(b.closures ?? [])]).filter((b) => b.type !== "class")
  .map((b) => ({ name: b.name, line: b.lineno, cc: b.complexity }));
const mcc = execFileSync(`${VENV}/bin/python`, ["-I", "-m", "mccabe", "--min", "1", py], { encoding: "utf8" })
  .trim().split("\n").map((l) => /^(\d+):(\d+): '(.*)' (\d+)$/.exec(l)).filter(Boolean)
  .map((m) => ({ name: m[3], line: Number(m[1]), cc: Number(m[4]) }));
const pcols = { treesitter: viaTreeSitter(py).fns, radon, mccabe: mcc, lizard: lizard(py, "python") };
const pmaps = Object.fromEntries(Object.entries(pcols).map(([k, v]) => [k, byLine(v)]));
const plines = [...new Set(Object.values(pcols).flatMap((v) => v.map((f) => f.line)))].sort((a, b) => a - b);
console.log(`\n| line | function | ${Object.keys(pcols).join(" | ")} |\n|${["", "", ...Object.keys(pcols)].map(() => " --- ").join("|")}|`);
for (const l of plines) {
  const name = Object.values(pmaps).map((m) => m.get(l)?.name).find(Boolean);
  console.log(`| ${l} | ${name} | ${Object.keys(pcols).map((k) => pmaps[k].get(l)?.cc ?? "-").join(" | ")} |`);
}
