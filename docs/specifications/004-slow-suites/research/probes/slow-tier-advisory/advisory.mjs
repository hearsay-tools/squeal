// Throwaway, read-only: the advisory set an edit range would name among cezarion's browser specs:
// one-hop importers of a changed path (the runner's `direct`), plus specs with token evidence (004 D2's
// signal b2: tokens from each changed file and its local imports, matched against each spec and its
// ./ helpers, tokens more than 20 specs match dropped). Reads git objects only (`git show`, `ls-tree`).
// Usage: node advisory.mjs <cezarion repo> <from> <to> [spec ...wanted]
import { execFileSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { has, tokensOf } from "../issue-4-signals/tokens.mjs";

const [C, from, to, ...wanted] = process.argv.slice(2);
const E2E = "packages/web/e2e";
const git = (...a) => execFileSync("git", ["-C", C, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const show = (rev, p) => { try { return git("show", `${rev}:${p}`); } catch { return ""; } };
const tree = new Set(git("ls-tree", "-r", "--name-only", to).split("\n"));
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];
const imports = (p, text) => [...text.matchAll(IMPORT)].map((m) => normalize(join(dirname(p), m[1]))).map((b) => EXTS.map((e) => b + e).find((x) => tree.has(x))).filter(Boolean);

const changed = git("diff", "--name-only", from, to).split("\n").filter(Boolean);
const specs = [...tree].filter((p) => p.startsWith(`${E2E}/`) && p.endsWith(".e2e.ts"));
const specText = new Map(specs.map((s) => [s, show(to, s)]));
const specSide = new Map(specs.map((s) => [s, [specText.get(s), ...imports(s, specText.get(s)).filter((h) => h.startsWith(`${E2E}/`)).map((h) => show(to, h))].join("\n")]));
const oneHop = new Set(specs.filter((s) => imports(s, specText.get(s)).some((p) => changed.includes(p))));
const src = changed.filter((p) => /\.(tsx?|css|mjs)$/.test(p) && tree.has(p)).flatMap((p) => { const t = show(to, p); return [t, ...imports(p, t).map((q) => show(to, q))]; }).join("\n");
const all = [...tokensOf(src)];
const hits = new Map(all.map((t) => [t, specs.filter((s) => has(specSide.get(s), t))]));
const kept = all.filter((t) => hits.get(t).length > 0 && hits.get(t).length <= 20);
const evidence = new Set(kept.flatMap((t) => hits.get(t)));
const named = new Set([...oneHop, ...evidence]);
const short = (s) => s.replace(`${E2E}/`, "");
console.log(JSON.stringify({
  range: `${from}..${to}`, changed: changed.length, changedWeb: changed.filter((p) => p.startsWith("packages/web/")),
  specs: specs.length, oneHop: [...oneHop].map(short), tokens: all.length, kept, dropped: all.filter((t) => hits.get(t).length > 20),
  named: [...named].map(short),
  wanted: wanted.map((w) => ({ spec: w, named: named.has(`${E2E}/${w}`), tokens: kept.filter((t) => hits.get(t).includes(`${E2E}/${w}`)) })),
}, null, 1));
