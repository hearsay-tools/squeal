// Throwaway probe for 015-10 Part B. Not product code. Reads git objects only.
//   tsx q1-all.mts <repo> <commit> <docs-excluded 0|1> <out.json>
// Counts every included file at <commit> with the released counter (counter-294) and lists each
// function over 20 with its optional-chain and default decisions and an estimate of its `??`
// operators (the counter stores `??` inside `logical`).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { countFile } from "../counter-294/src/core/code/count/index.ts";
const [repo, commit, docs, out] = process.argv.slice(2);
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 28 });
const included = (p: string) =>
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/.test(p) && !/(^|\/)(dist|build|vendor)\//.test(p) && !p.endsWith(".min.js") &&
  !(docs === "1" && p.startsWith("docs/"));
const paths = git("ls-tree", "-r", "--name-only", commit).toString().split("\n").filter(included);
const over: any[] = [];
let functions = 0;
for (const p of paths) {
  const buf = git("show", `${commit}:${p}`);
  if (buf.length > 524288) continue;
  const text = buf.toString("utf8");
  const k = await countFile(text, p.endsWith(".py") ? "python" : "typescript");
  functions += k.functions.length;
  const lines = text.split("\n");
  const slice = (r: any) => { const a = lines.slice(r.startLine - 1, r.endLine); a[a.length - 1] = a[a.length - 1].slice(0, r.endColumn); a[0] = a[0].slice(r.startColumn); return a.join("\n"); };
  const n = (s: string) => (s.match(/\?\?(?!=)/g) ?? []).length;
  const inside = (r: any, o: any) => (o.startLine > r.startLine || (o.startLine === r.startLine && o.startColumn > r.startColumn)) && (o.endLine < r.endLine || (o.endLine === r.endLine && o.endColumn <= r.endColumn));
  for (const f of k.functions as any[]) {
    if (f.complexity <= 20) continue;
    const kids = (k.functions as any[]).filter((o) => o !== f && inside(f.range, o.range));
    const own = n(slice(f.range)) - kids.filter((o) => !kids.some((m) => m !== o && inside(m.range, o.range))).reduce((s, o) => s + n(slice(o.range)), 0);
    const d = f.decisions ?? {};
    over.push({ path: p, name: f.qualifiedName, cc: f.complexity, oc: d["optional-chain"] ?? 0, def: d["default"] ?? 0, nn: p.endsWith(".py") ? 0 : Math.max(0, own) });
  }
}
writeFileSync(out, JSON.stringify({ files: paths.length, functions, over }));
const only = over.filter((f) => f.cc - f.oc - f.def - f.nn <= 20);
const onlyOcDef = over.filter((f) => f.cc - f.oc - f.def <= 20);
console.log(JSON.stringify({ files: paths.length, functions, over: over.length, overOnlyByOcDef: onlyOcDef.length, overOnlyByOcDefNullish: only.length }));
