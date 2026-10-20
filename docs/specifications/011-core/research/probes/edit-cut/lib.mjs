// THROWAWAY probe (011-core/research/edit-cut.md, row 011-25). Shared pieces: the two
// repositories' module graphs at a commit (the method of ../central-edits/graph.mjs, generalized
// from cezar to Squeal), the namesake matchers, the stores (read-only copies), quantiles and
// gzipped results. Read-only on both repositories: trees come from `git archive <sha>` into a
// scratch directory, blobs from `git cat-file`.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { init, parse } from "es-module-lexer";
import { transformSync } from "rolldown/utils";

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TS = /\.(ts|tsx|mts|cts|jsx)$/;
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const CEZAR_PACKAGES = { "@open-mercato/cezar-contract": "packages/contract/src", "@open-mercato/cezar-api-client": "packages/api-client/src" };

/** The two repositories this probe reads. `verbatim(path)`: whether the file's tsconfig sets `verbatimModuleSyntax`. */
export const REPOS = {
  cezar: {
    git: "/home/agent/projects/cezar", store: process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite",
    scratch: "/tmp/r25/trees", archive: ["packages", "scripts", ".github"],
    verbatim: (p) => p.startsWith("packages/web/"),
    alias(importer, spec) {
      if (spec.startsWith("@/") && importer.startsWith("packages/web/")) return `packages/web/src/${spec.slice(2)}`;
      const pkg = Object.keys(CEZAR_PACKAGES).find((p) => spec === p || spec.startsWith(`${p}/`));
      if (!pkg) return null;
      const sub = spec.slice(pkg.length + 1);
      return sub ? `${CEZAR_PACKAGES[pkg]}/${sub}` : `${CEZAR_PACKAGES[pkg]}/index`;
    },
    slow: /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/,
    nodeTest: new Set(["test:unit", "root:test:unit", "test:package"]),
  },
  squeal: {
    git: "/home/agent/projects/squeal", store: process.env.R25B_STORE ?? "/tmp/r25b/squeal-store.sqlite",
    scratch: "/tmp/r25b/trees", archive: ["src", "test", "plugins", "scripts", "evals"],
    verbatim: () => true, alias: () => null, slow: /^$/, nodeTest: new Set(),
  },
};

export const openStore = (repo) => new DatabaseSync(REPOS[repo].store, { readOnly: true });

await init;

function tree(repo, sha) {
  const r = REPOS[repo];
  const dir = join(r.scratch, sha);
  if (!existsSync(join(dir, ".done"))) {
    mkdirSync(dir, { recursive: true });
    // A path the commit lacks makes `git archive` fail, so ask only for those it has.
    const have = execFileSync("git", ["-C", r.git, "ls-tree", "--name-only", sha], { encoding: "utf8" }).split("\n");
    const paths = r.archive.filter((p) => have.includes(p));
    execSync(`git -C ${r.git} archive ${sha} -- ${paths.join(" ")} | tar -x -C ${dir} && touch ${dir}/.done`);
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
export function specifiers(repo, path, source) {
  try {
    let code = source;
    if (TS.test(path)) {
      const r = transformSync(path, source, { typescript: { onlyRemoveTypeImports: REPOS[repo].verbatim(path) }, jsx: { runtime: "automatic" } });
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

function resolve(repo, exists, importer, spec) {
  spec = spec.replace(/[?#].*$/, "");
  let base;
  if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(posix.dirname(importer), spec));
  else base = REPOS[repo].alias(importer, spec);
  if (base === null) return null;
  const cands = [base];
  const m = base.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) cands.push(base.slice(0, -m[0].length) + (m[1] === "mjs" ? ".mts" : m[1] === "cjs" ? ".cts" : ".ts"), base.slice(0, -m[0].length) + ".tsx");
  for (const e of EXTS) cands.push(base + e);
  for (const e of EXTS) cands.push(`${base}/index${e}`);
  return cands.find((c) => exists(c)) ?? null;
}

/** The graph at `sha`: edges (file → its one-hop project imports), the file set and parse failures. */
export function graphAt(repo, sha) {
  const dir = tree(repo, sha);
  const files = walk(dir);
  const set = new Set(files);
  const exists = (p) => set.has(p) || (p.endsWith(".json") && existsSync(join(dir, p)) && statSync(join(dir, p)).isFile());
  const edges = new Map();
  const failed = [];
  for (const f of files) {
    const specs = specifiers(repo, f, readFileSync(join(dir, f), "utf8"));
    if (specs === null) { failed.push(f); edges.set(f, new Set()); continue; }
    edges.set(f, new Set(specs.map((s) => resolve(repo, exists, f, s)).filter((p) => p !== null)));
  }
  return { repo, sha, dir, files: set, exists, edges, failed };
}

const blobs = new Map();
/** `file`'s edges from a blob of the repository's object store (a revision's new content), or null. */
export function edgesOfBlob(repo, view, file, blob) {
  if (!CODE.test(file) || file.includes("/dist/") || file.includes("node_modules/")) return null;
  const k = `${repo}:${blob}`;
  if (!blobs.has(k)) {
    try { blobs.set(k, execFileSync("git", ["-C", REPOS[repo].git, "cat-file", "blob", blob], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
    catch { blobs.set(k, null); }
  }
  const source = blobs.get(k);
  if (source === null) return null;
  const specs = specifiers(repo, file, source);
  if (specs === null) return null;
  return new Set(specs.map((s) => resolve(repo, view.exists, file, s)).filter((p) => p !== null));
}

/** Breadth-first depth of every file `entry` reaches (entry 0, its imports 1, …). */
export function depths(edges, entry) {
  const d = new Map([[entry, 0]]);
  const q = [entry];
  for (let i = 0; i < q.length; i++) for (const n of edges.get(q[i]) ?? []) if (!d.has(n)) { d.set(n, d.get(q[i]) + 1); q.push(n); }
  return d;
}

// ---- Namesakes ------------------------------------------------------------------------------

const TEST_MARK = /(\.(test|spec))?\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** A test file's stem: its basename without `.test`/`.spec` and extension, or pytest's `test_`/`_test`. */
export function testStem(path) {
  const b = posix.basename(path);
  if (b.endsWith(".py")) return b.slice(0, -3).replace(/^test_/, "").replace(/_test$/, "");
  return b.replace(TEST_MARK, "");
}
/** A source's stem: its basename without extension (`index` keeps its directory's name too, see below). */
export const sourceStem = (path) => posix.basename(path).replace(/\.[^.]+$/, "");

/** Strips a source root (`src/`, `lib/`, `packages/<p>/src/`) and returns [package prefix, rest], or null. */
function underRoot(path) {
  const m = path.match(/^((?:packages|apps)\/[^/]+\/)?(src|lib)\/(.*)$/);
  return m ? [m[1] ?? "", m[3]] : null;
}

/**
 * The matchers the brief names, each a predicate over (changed source, test file). A test file
 * of the same stem only:
 *   sibling     `<dir>/<stem>.test|spec.<ext>` (pytest: `<dir>/test_<stem>.py`, `<dir>/<stem>_test.py`)
 *   __tests__   `<dir>/__tests__/<stem>[.test|.spec].<ext>`
 *   mirror      `src/<sub>/<stem>.ts` → `test|tests/<sub>/<stem>.test.ts` (and `packages/<p>/…`)
 *   pytest      `test_<stem>.py` or `<stem>_test.py` anywhere
 *   anywhere    any test file of the stem, in any directory (the loosest)
 */
export const MATCHERS = {
  sibling: (src, t) => posix.dirname(t) === posix.dirname(src) && testStem(t) === sourceStem(src) && t !== src,
  __tests__: (src, t) => posix.dirname(t) === `${posix.dirname(src)}/__tests__` && testStem(t) === sourceStem(src),
  mirror: (src, t) => {
    const u = underRoot(src);
    if (!u) return false;
    const [pkg, rest] = u;
    const want = posix.dirname(rest) === "." ? "" : `${posix.dirname(rest)}/`;
    return testStem(t) === sourceStem(src) && [`${pkg}test/${want}`, `${pkg}tests/${want}`].some((d) => posix.dirname(`${t}`) + "/" === d);
  },
  pytest: (src, t) => t.endsWith(".py") && src.endsWith(".py") && testStem(t) === sourceStem(src) && /^(test_.*|.*_test)\.py$/.test(posix.basename(t)),
  anywhere: (src, t) => testStem(t) === sourceStem(src) && t !== src,
};

/** Each matcher's namesakes of `src` among `tests` (paths). */
export function namesakes(src, tests) {
  const out = {};
  for (const [k, m] of Object.entries(MATCHERS)) out[k] = tests.filter((t) => m(src, t));
  return out;
}

/**
 * The rule (n) uses: the strict matchers in order (sibling, __tests__, mirror, pytest), the first
 * that finds any wins; `anywhere` only when its match is unique. An `index` source never matches
 * by stem (every directory has one).
 */
export function namesakeOf(src, tests) {
  if (sourceStem(src) === "index") return [];
  const n = namesakes(src, tests);
  for (const k of ["sibling", "__tests__", "mirror", "pytest"]) if (n[k].length) return n[k];
  return n.anywhere.length === 1 ? n.anywhere : [];
}

// ---- Numbers and results --------------------------------------------------------------------

export const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
export const median = (xs) => q(xs, 0.5);
export const readResult = (name) => JSON.parse(gunzipSync(readFileSync(new URL(`results/${name}.json.gz`, import.meta.url))));
/** classify.mjs's revisions with each one's `present` test files rebuilt from its head's. */
export function readClassified(repo) {
  const { heads, revisions } = readResult(`classified-${repo}`);
  return revisions.map((r) => {
    const removed = new Set(r.presentRemoved);
    return { ...r, present: [...heads[r.head].filter((p) => !removed.has(p)), ...r.presentAdded] };
  });
}
export const writeResult = (name, data) => writeFileSync(new URL(`results/${name}.json.gz`, import.meta.url), gzipSync(JSON.stringify(data)));
