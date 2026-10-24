// Throwaway probe for 015-10 Part B. Not product code. Reads git objects only.
//   tsx commits.mts <repo> <from> <to> <docs-excluded 0|1> <out.json>
// For every commit in from..to: counts both sides of each included file it changed with the
// released counter (counter-294, D2's identity), pairs removed and added functions by body hash
// as D2 does, and lists crossings, edits of failing functions and unmatched functions over 20.
// Also times one count of each changed file's new side with counter-283 (CPU ms) per commit.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpuUsage } from "node:process";
import { countFile } from "../counter-294/src/core/code/count/index.ts";
import { countFile as countOld } from "../counter-283/src/core/code/count/index.ts";

const [repo, from, to, docs, out] = process.argv.slice(2);
const T = 20;
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const show = (rev: string, p: string) => {
  try { return execFileSync("git", ["-C", repo, "show", `${rev}:${p}`], { maxBuffer: 1 << 28 }); } catch { return null; }
};
const included = (p: string) =>
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/.test(p) && !/(^|\/)(dist|build|vendor)\//.test(p) && !p.endsWith(".min.js") &&
  !(docs === "1" && p.startsWith("docs/"));
const lang = (p: string) => (p.endsWith(".py") ? "python" : "typescript");
const load = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const nullish = (text: string, f: any, all: any[]) => {
  // `??` tokens in the function's own text, nested functions' text left out (an estimate).
  const lines = text.split("\n");
  const slice = (r: any) => {
    const a = lines.slice(r.startLine - 1, r.endLine);
    if (a.length === 0) return "";
    a[a.length - 1] = a[a.length - 1].slice(0, r.endColumn);
    a[0] = a[0].slice(r.startColumn);
    return a.join("\n");
  };
  const inside = (r: any, o: any) => (o.startLine > r.startLine || (o.startLine === r.startLine && o.startColumn > r.startColumn)) &&
    (o.endLine < r.endLine || (o.endLine === r.endLine && o.endColumn <= r.endColumn));
  const n = (s: string) => (s.match(/\?\?(?!=)/g) ?? []).length;
  const kids = all.filter((o) => o !== f && inside(f.range, o.range) && !all.some((m) => m !== f && m !== o && inside(f.range, m.range) && inside(m.range, o.range)));
  return n(slice(f.range)) - kids.reduce((s, k) => s + n(slice(k.range)), 0);
};
const shape = (p: string, f: any, text: string, all: any[]) => {
  const d = f.decisions ?? {};
  const nn = lang(p) === "typescript" ? Math.max(0, nullish(text, f, all)) : 0;
  return { path: p, name: f.qualifiedName, occ: f.occurrence, cc: f.complexity, body: f.bodyHash, line: f.range.startLine,
    oc: d["optional-chain"] ?? 0, def: d["default"] ?? 0, nn };
};

const commits = git("rev-list", "--reverse", `${from}..${to}`).split("\n").filter(Boolean);
await countFile("const a = 1;\n", "typescript");
await countOld("const a = 1;\n", "typescript");
const result: any[] = [];
for (const c of commits) {
  const subject = git("log", "-1", "--format=%cI %s", c).trim();
  const parent = git("rev-parse", `${c}^`).trim();
  const rows = git("diff-tree", "--no-commit-id", "-r", "-M", "--name-status", parent, c).split("\n").filter(Boolean);
  const before: any[] = [];
  const after: any[] = [];
  let cpu = 0, files = 0, tooBig = 0;
  for (const r of rows) {
    const [st, a, b] = r.split("\t");
    const oldP = a, newP = st.startsWith("R") || st.startsWith("C") ? b : a;
    if (!included(oldP) && !included(newP)) continue;
    const ob = st === "A" ? null : show(parent, oldP);
    const nb = st === "D" ? null : show(c, newP);
    if ((ob && ob.length > 524288) || (nb && nb.length > 524288)) { tooBig++; continue; }
    files++;
    if (ob && included(oldP)) { const t = ob.toString("utf8"); const k = await countFile(t, lang(oldP)); for (const f of k.functions) before.push(shape(oldP, f, t, k.functions as any)); }
    if (nb && included(newP)) {
      const t = nb.toString("utf8"); const k = await countFile(t, lang(newP));
      for (const f of k.functions) after.push(shape(newP, f, t, k.functions as any));
      const c0 = cpuUsage(); await countOld(t, lang(newP)); const d = cpuUsage(c0); cpu += (d.user + d.system) / 1000;
    }
  }
  if (files === 0 && tooBig === 0) continue;
  const key = (f: any) => `${f.path}\u0000${f.name}\u0000${f.occ}`;
  const B = new Map(before.map((f) => [key(f), f]));
  const A = new Map(after.map((f) => [key(f), f]));
  const gone = before.filter((f) => !A.has(key(f)));
  const added = after.filter((f) => !B.has(key(f)));
  const moves: any[] = [];
  const unGone: any[] = [];
  const left = [...added];
  for (const g of gone) {
    let i = left.findIndex((x) => x.body === g.body && x.path === g.path);
    if (i < 0) i = left.findIndex((x) => x.body === g.body);
    if (i >= 0) { moves.push({ from: g, to: left[i] }); left.splice(i, 1); } else unGone.push(g);
  }
  const crossings: any[] = [];
  const stillFail: any[] = [];
  for (const [k, a] of A) {
    const b = B.get(k);
    if (!b) continue;
    if (b.cc <= T && a.cc > T) crossings.push({ kind: "pass-to-fail", from: b.cc, ...a });
    else if (b.cc > T && a.cc <= T) crossings.push({ kind: "fail-to-pass", from: b.cc, ...a });
    else if (b.cc > T && a.cc > T && b.body !== a.body) stillFail.push({ from: b.cc, ...a });
  }
  for (const n of left) if (n.cc > T) crossings.push({ kind: "first-seen-fail", from: null, ...n });
  for (const g of unGone) if (g.cc > T) crossings.push({ kind: "removed", from: g.cc, ...g, cc: null });
  result.push({ commit: c, subject, files, tooBig, functionsAfter: after.length, cpuMs: +cpu.toFixed(2), load: load(),
    moves: moves.length, movesOver: moves.filter((m) => m.from.cc > T).map((m) => [m.from.path, m.from.name, m.to.path, m.to.name, m.from.cc]),
    anonRenamed: unGone.filter((g) => g.name.includes("<")).length, unmatchedGone: unGone.length, unmatchedNew: left.length,
    unmatchedPairs: unGone.filter((g) => left.some((n) => n.path === g.path && n.cc === g.cc)).map((g) => [g.path, g.name, g.cc,
      left.filter((n) => n.path === g.path && n.cc === g.cc).map((n) => n.name)]),
    crossings, stillFail });
}
writeFileSync(out, JSON.stringify(result));
console.log(commits.length, "commits;", result.length, "with included files");
