// Throwaway (glob-membership, Q4): which test files' stored closure lists hold
// a module whose source at <ref> matches Squeal's DYNAMIC_SPECIFIER regex
// (src/runners/vitest/dynamic.ts at 75e44e78f), and which hold a module whose
// syntax tree has a real `import.meta.glob(...)` call or an `import()` of a
// template literal with a substitution (esbuild strips types, acorn parses). Paths matched by
// the repository's policy `inputs` (declared inputs, not modules) are listed
// apart. Reads git with ls-tree and cat-file only.
// Usage: node modules.mjs <scratch.sqlite> <repo> <ref> <out.json>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(new URL("../../../../../../package.json", import.meta.url));
const esbuild = require("esbuild");
const acorn = require("acorn");
const walkFull = (node, visit) => {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walkFull(n, visit));
  if (typeof node.type === "string") visit(node);
  for (const [k, v] of Object.entries(node)) if (k !== "type" && typeof v === "object") walkFull(v, visit);
};
const DYNAMIC_SPECIFIER = /import\.meta\.glob|\bimport\s*\(\s*`[^`]*\$\{/;
const [scratch, repo, ref, out] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 30 });
const tree = new Map();
for (const line of git("ls-tree", "-r", ref).split("\n")) {
  const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
  if (m) tree.set(m[2], m[1]);
}
function realCalls(path, text) {
  const ext = path.split(".").pop();
  const loader = { ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", jsx: "jsx" }[ext] ?? "js";
  let code;
  try {
    code = esbuild.transformSync(text, { loader, format: "esm", target: "esnext" }).code;
  } catch (e) {
    return [{ kind: "unparsed", arg: String(e.message).split("\n")[0] }];
  }
  const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  const found = [];
  walkFull(ast, (n) => {
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression"
      && n.callee.object.type === "MetaProperty" && n.callee.object.meta.name === "import"
      && n.callee.property.name === "glob") {
      found.push({ kind: "glob", arg: code.slice(n.arguments[0]?.start ?? 0, n.arguments[0]?.end ?? 0) });
    }
    if (n.type === "ImportExpression" && n.source.type === "TemplateLiteral" && n.source.expressions.length > 0) {
      found.push({ kind: "template", arg: code.slice(n.source.start, n.source.end) });
    }
  });
  return found;
}
const db = new DatabaseSync(scratch, { readOnly: true });
const rows = db.prepare("select project, path, closure_paths from test_files").all();
const atRef = rows.filter((r) => tree.has(r.path));
const paths = new Set();
for (const r of atRef) for (const p of JSON.parse(r.closure_paths)) if (tree.has(p)) paths.add(p);
const list = [...paths].filter((p) => /\.(m|c)?[jt]sx?$|\.vue$|\.svelte$/.test(p));
const regex = new Set();
const real = {};
const batch = execFileSync("git", ["-C", repo, "cat-file", "--batch"], {
  input: list.map((p) => tree.get(p)).join("\n") + "\n", maxBuffer: 1 << 30,
});
let at = 0;
for (const p of list) {
  const nl = batch.indexOf(10, at);
  const size = Number(batch.subarray(at, nl).toString().split(" ")[2]);
  const body = batch.subarray(nl + 1, nl + 1 + size).toString("utf8");
  at = nl + 1 + size + 1;
  if (!DYNAMIC_SPECIFIER.test(body)) continue;
  regex.add(p);
  const calls = realCalls(p, body);
  if (calls.length > 0) real[p] = calls;
}
const count = (set) => {
  const files = atRef.filter((r) => JSON.parse(r.closure_paths).some((p) => set.has(p)));
  const byProject = {};
  for (const r of files) byProject[r.project] = (byProject[r.project] ?? 0) + 1;
  return { testFiles: files.length, byProject, files: files.map((r) => `${r.project}:${r.path}`) };
};
const projects = {};
for (const r of atRef) projects[r.project] = (projects[r.project] ?? 0) + 1;
const byModule = (set) => Object.fromEntries([...set].sort().map((m) => [m,
  atRef.filter((r) => JSON.parse(r.closure_paths).includes(m)).length]));
const realSet = new Set(Object.keys(real));
const result = {
  ref: git("rev-parse", ref).trim(), storedLists: rows.length, testFilesAtRef: atRef.length,
  testFilesByProject: projects, modulesRead: list.length,
  regex: { modules: byModule(regex), ...count(regex) },
  real: { modules: byModule(realSet), calls: real, ...count(realSet) },
};
writeFileSync(out, JSON.stringify(result, null, 1));
const brief = (x) => ({ ...x, files: undefined });
console.log(JSON.stringify({ ...result, regex: brief(result.regex), real: brief(result.real) }, null, 1));
