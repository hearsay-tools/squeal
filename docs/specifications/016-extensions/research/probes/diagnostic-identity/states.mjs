// Throwaway probe (016-33). Writes the fixture states s0..s7 for TypeScript,
// JavaScript (ESLint) and Python (Ruff). Each state is one recorded edit of
// the state before it. The same three findings exist in every language:
//   N  an unused local `count` (the message names the variable)
//   A  a call to the undefined name `report` (repeated in s3 on an identical line)
//   B  a call to the undefined name `notify` in function beta (moved in s5)
// Usage: node states.mjs <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];

// One state as flags; each language renders the flags to source.
const states = [
  { name: "s0-baseline" },
  { name: "s1-insert-line-above", header: true },
  { name: "s2-rename-named-variable", header: true, renamed: true },
  { name: "s3-add-identical-finding", header: true, renamed: true, dup: true },
  { name: "s4-fix-first-of-two-identical", header: true, renamed: true, dup: true, fixFirst: true },
  { name: "s5-move-function-to-other-file", header: true, renamed: true, dup: true, fixFirst: true, moved: true },
  { name: "s6-fix-last-finding-of-b", header: true, renamed: true, dup: true, fixFirst: true, moved: true, fixB: true },
  { name: "s7-change-type-in-b-only", header: true, renamed: true, dup: true, fixFirst: true, moved: true, fixB: true, limitString: true },
];

function ts(s) {
  const v = s.renamed ? "tally" : "count";
  const beta = ["export function beta(): number {", ...(s.fixB ? [] : ["  notify(2);"]), "  return 0;", "}"];
  const a = [
    ...(s.header ? ["// header added by edit s1"] : []),
    'import { limit } from "./b";',
    "",
    "export function alpha(): number {",
    `  const ${v} = 1;`,
    ...(s.fixFirst ? [] : ["  report(1);"]),
    "  return 0;",
    "}",
    "",
    ...(s.moved ? [] : [...beta, ""]),
    "export function gamma(): number {",
    ...(s.dup ? ["  report(1);"] : []),
    "  return limit;",
    "}",
  ];
  const b = [s.limitString ? 'export const limit: string = "3";' : "export const limit: number = 3;", ...(s.moved ? ["", ...beta] : [])];
  return { "a.ts": a, "b.ts": b };
}

function js(s) {
  const v = s.renamed ? "tally" : "count";
  const beta = ["export function beta() {", ...(s.fixB ? [] : ["  notify(2);"]), "  return 0;", "}"];
  const a = [
    ...(s.header ? ["// header added by edit s1"] : []),
    'import { limit } from "./b.js";',
    "",
    "export function alpha() {",
    `  const ${v} = 1;`,
    ...(s.fixFirst ? [] : ["  report(1);"]),
    "  return 0;",
    "}",
    "",
    ...(s.moved ? [] : [...beta, ""]),
    "export function gamma() {",
    ...(s.dup ? ["  report(1);"] : []),
    "  return limit;",
    "}",
  ];
  const b = [s.limitString ? 'export const limit = "3";' : "export const limit = 3;", ...(s.moved ? ["", ...beta] : [])];
  return { "a.js": a, "b.js": b };
}

function py(s) {
  const v = s.renamed ? "tally" : "count";
  const beta = ["def beta():", ...(s.fixB ? [] : ["    notify(2)"]), "    return 0"];
  const a = [
    ...(s.header ? ["# header added by edit s1"] : []),
    "from b import limit",
    "",
    "",
    "def alpha():",
    `    ${v} = 1`,
    ...(s.fixFirst ? [] : ["    report(1)"]),
    "    return 0",
    "",
    "",
    ...(s.moved ? [] : [...beta, "", ""]),
    "def gamma():",
    ...(s.dup ? ["    report(1)"] : []),
    "    return limit",
  ];
  const b = [s.limitString ? 'limit = "3"' : "limit = 3", ...(s.moved ? ["", "", ...beta] : [])];
  return { "a.py": a, "b.py": b };
}

for (const [lang, render] of [["ts", ts], ["js", js], ["py", py]]) {
  states.forEach((s) => {
    const dir = join(out, lang, s.name);
    mkdirSync(dir, { recursive: true });
    for (const [file, lines] of Object.entries(render(s))) writeFileSync(join(dir, file), `${lines.join("\n")}\n`);
  });
}
console.log(states.map((s) => s.name).join("\n"));
