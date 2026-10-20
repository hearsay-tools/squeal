// THROWAWAY probe (011-core/research/central-edits.md, row 011-25). A static module graph of
// cezar's code at a commit, built the way Vite 8 sees one hop: each file transformed by oxc
// (rolldown 1.1.5, the transform Vite 8.1.4 uses; `onlyRemoveTypeImports` where the package's
// tsconfig sets `verbatimModuleSyntax`, as Vite reads it), then its static and literal dynamic
// imports read by es-module-lexer 2.3.1; `require("…")` in `.cjs` files by a regex. Specifiers
// resolve by cezar's rules: relative (as written, `.js` → `.ts`/`.tsx`, extension and `index`
// candidates), `@/…` → packages/web/src (vite.config.ts), and the workspace packages
// `@open-mercato/cezar-contract` and `@open-mercato/cezar-api-client` to their `src` (their
// `exports`). Other bare specifiers are packages and left out. Read-only on cezar: the tree
// comes from `git archive <sha>` into a scratch directory.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, join, posix } from "node:path";
import { init, parse } from "es-module-lexer";
import { transformSync } from "rolldown/utils";

export const CEZAR = "/home/agent/projects/cezar";
const SCRATCH = process.env.R25_SCRATCH ?? "/tmp/r25/trees";
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TS = /\.(ts|tsx|mts|cts|jsx)$/;
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const PACKAGES = { "@open-mercato/cezar-contract": "packages/contract/src", "@open-mercato/cezar-api-client": "packages/api-client/src" };

await init;

/** Extracts `sha`'s tree (only what holds code) once; returns its directory. */
export function tree(sha) {
  const dir = join(SCRATCH, sha);
  if (!existsSync(join(dir, ".done"))) {
    mkdirSync(dir, { recursive: true });
    execSync(`git -C ${CEZAR} archive ${sha} -- packages scripts .github | tar -x -C ${dir} && touch ${dir}/.done`);
  }
  return dir;
}

function walk(root, rel = "", out = []) {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(root, p, out); }
    else if (CODE.test(e.name)) out.push(p);
  }
  return out;
}

/** Specifiers one file imports, as Vite's transform leaves them. `null` when it does not parse. */
export function specifiers(path, source) {
  try {
    let code = source;
    if (TS.test(path)) {
      const verbatim = path.startsWith("packages/web/");
      const r = transformSync(path, source, { typescript: { onlyRemoveTypeImports: verbatim }, jsx: { runtime: "automatic" } });
      if (r.errors?.length) return null;
      code = r.code;
    }
    const out = [];
    if (path.endsWith(".cjs")) for (const m of code.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) out.push(m[1]);
    else for (const i of parse(code)[0]) if (i.n !== undefined) out.push(i.n);
    return out;
  } catch {
    return null;
  }
}

/** A specifier's project file, or null (a package, a builtin, or nothing on disk). */
export function resolve(exists, importer, spec) {
  spec = spec.replace(/[?#].*$/, "");
  let base;
  if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(posix.dirname(importer), spec));
  else if (spec.startsWith("@/") && importer.startsWith("packages/web/")) base = `packages/web/src/${spec.slice(2)}`;
  else {
    const pkg = Object.keys(PACKAGES).find((p) => spec === p || spec.startsWith(`${p}/`));
    if (!pkg) return null;
    const sub = spec.slice(pkg.length + 1);
    base = sub ? `${PACKAGES[pkg]}/${sub}` : `${PACKAGES[pkg]}/index`;
  }
  const cands = [base];
  const m = base.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) cands.push(base.slice(0, -m[0].length) + (m[1] === "mjs" ? ".mts" : m[1] === "cjs" ? ".cts" : ".ts"), base.slice(0, -m[0].length) + ".tsx");
  for (const e of EXTS) cands.push(base + e);
  for (const e of EXTS) cands.push(`${base}/index${e}`);
  return cands.find((c) => exists(c)) ?? null;
}

/** The graph at `sha`: edges (file → its one-hop project imports) and parse failures. */
export function graphAt(sha) {
  const dir = tree(sha);
  const files = walk(dir);
  const set = new Set(files);
  const exists = (p) => set.has(p) || (p.endsWith(".json") && existsSync(join(dir, p)) && statSync(join(dir, p)).isFile());
  const edges = new Map();
  const failed = [];
  for (const f of files) {
    const specs = specifiers(f, readFileSync(join(dir, f), "utf8"));
    if (specs === null) { failed.push(f); edges.set(f, new Set()); continue; }
    edges.set(f, new Set(specs.map((s) => resolve(exists, f, s)).filter((p) => p !== null)));
  }
  return { sha, dir, files: set, exists, edges, failed };
}

const blobs = new Map();
/** `file`'s edges from a blob of cezar's object store (a revision's new content), or null. */
export function edgesOfBlob(graph, file, blob) {
  if (!CODE.test(file) || file.includes("/dist/") || file.includes("node_modules/")) return null;
  if (!blobs.has(blob)) {
    try { blobs.set(blob, execFileSync("git", ["-C", CEZAR, "cat-file", "blob", blob], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
    catch { blobs.set(blob, null); }
  }
  const source = blobs.get(blob);
  if (source === null) return null;
  const specs = specifiers(file, source);
  if (specs === null) return null;
  return new Set(specs.map((s) => resolve(graph.exists, file, s)).filter((p) => p !== null));
}

/** Breadth-first depth of every file `entry` reaches (entry 0, its imports 1, …). */
export function depths(edges, entry) {
  const d = new Map([[entry, 0]]);
  const q = [entry];
  for (let i = 0; i < q.length; i++) for (const n of edges.get(q[i]) ?? []) if (!d.has(n)) { d.set(n, d.get(q[i]) + 1); q.push(n); }
  return d;
}

/** A result file of this probe, gzipped JSON (`results/<name>.json.gz`). */
export const readResult = (name) => JSON.parse(gunzipSync(readFileSync(new URL(`results/${name}.json.gz`, import.meta.url))));
export const writeResult = (name, data) => writeFileSync(new URL(`results/${name}.json.gz`, import.meta.url), gzipSync(JSON.stringify(data)));
