// Throwaway (007-04): copy of ../python-module-graph/node_graph.mjs with two additions:
//   --roots=<derived.json>  no environment: sys.path is the basedirs plus the roots roots.mjs derived
//   candidates per file, as ast_graph.py defines them; --sym treats a winner outside the worktree as absent
// node node_graph.mjs <root> <out.json> [--parser=scan|treesitter] [--venv=.venv] [--skip-type-checking]
//
// sys.path is modelled from files: pytest's prepend basedirs of every test/conftest, the
// stdlib directory named by pyvenv.cfg `home`, site-packages, then each .pth in name order:
// path lines become entries, setuptools `__editable___*_finder.py` MAPPING literals and
// hatchling/editables `map_module(...)` calls become mapping finders consulted after the path.
// Output has the same shape as ast_graph.py.
import fs from "node:fs";
import path from "node:path";

const [root0, out, ...flags] = process.argv.slice(2);
const root = fs.realpathSync(root0);
const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const parserKind = opt.parser ?? "scan";
const venv = path.join(root, opt.venv ?? ".venv");
const SKIP_TC = !!opt["skip-type-checking"];
const t0 = performance.now();

// ---------- files
const pyFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name.startsWith(".venv") || ["__pycache__", ".git", "node_modules"].includes(e.name)) continue;
      walk(path.join(d, e.name));
    } else if (e.name.endsWith(".py")) pyFiles.push(path.join(d, e.name));
  }
})(root);
pyFiles.sort();

// ---------- parsers: both yield {kind, mod, names, level, line, tc}
function scanParse(src) {
  // Blank strings and comments, keep string contents in a side table; join logical lines.
  const res = [];
  let i = 0, depth = 0, line = 1, cur = "", curLine = 1, indent = null;
  const lines = [];
  const push = () => {
    if (cur.trim()) lines.push({ text: cur, line: curLine, indent: indent ?? 0 });
    cur = ""; indent = null;
  };
  while (i < src.length) {
    const c = src[i];
    if (indent === null && cur === "" ) { curLine = line; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "\\" && src[i + 1] === "\n") { i += 2; line++; continue; }
    if (c === "\n") { line++; i++; if (depth === 0) push(); else cur += " "; continue; }
    const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    if (m && (m[1] === "" || !/[\w]/.test(src[i - 1] ?? ""))) {
      const q = m[2]; let j = i + m[0].length; let body = "";
      while (j < src.length && src.slice(j, j + q.length) !== q) {
        if (src[j] === "\\") { body += src[j + 1]; j += 2; continue; }
        if (src[j] === "\n") line++;
        body += src[j]; j++;
      }
      if (indent === null) { indent = cur.length - cur.trimStart().length; }
      cur += JSON.stringify(body); i = j + q.length; continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    if (indent === null && c !== " " && c !== "\t") indent = cur.length;
    cur += c; i++;
  }
  push();
  const tcStack = [];
  for (const { text, line: ln, indent: ind } of lines) {
    while (tcStack.length && ind <= tcStack[tcStack.length - 1]) tcStack.pop();
    const tc = tcStack.length > 0;
    for (const stmt0 of text.trim().split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const stmt = stmt0.trim();
      if (/^if\s+(\w+\.)?TYPE_CHECKING\s*:/.test(stmt)) { tcStack.push(ind); continue; }
      let m;
      if ((m = /^import\s+(.+)$/.exec(stmt))) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (/^[\w.]+$/.test(name)) res.push({ kind: "import", mod: name, names: [], level: 0, line: ln, tc });
        }
      } else if ((m = /^from\s+(\.*)\s*([\w.]*)\s+import\s+(.+)$/.exec(stmt))) {
        const names = m[3].replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        res.push({ kind: "from", mod: m[2], names, level: m[1].length, line: ln, tc });
      }
      const dynRe = /\b(?:import_module|__import__)\s*\(\s*(?:("(?:[^"\\]|\\.)*")\s*[,)])?/g;
      while ((m = dynRe.exec(stmt))) {
        if (m[1] && /^"[\w.]+"$/.test(m[1])) res.push({ kind: "dynamic", mod: JSON.parse(m[1]), names: [], level: 0, line: ln, tc });
        else if (!/^def\s/.test(stmt)) res.push({ kind: "computed", mod: null, names: [], level: 0, line: ln, tc });
      }
    }
  }
  return res;
}

let tsParser = null;
async function initTreeSitter() {
  const { Parser, Language } = await import("web-tree-sitter");
  await Parser.init();
  const lang = await Language.load(new URL("./node_modules/tree-sitter-python/tree-sitter-python.wasm", import.meta.url).pathname);
  tsParser = new Parser();
  tsParser.setLanguage(lang);
}
function tsParse(src) {
  const tree = tsParser.parse(src);
  const res = [];
  // 007-04 fix: any `<name>.TYPE_CHECKING` (click uses `t.TYPE_CHECKING`), as ast_graph.py's is_tc does.
  const isTC = (n) => n.type === "if_statement" && /^(\w+\.)?TYPE_CHECKING$/.test(n.childForFieldName("condition")?.text ?? "");
  const walk = (n, tc) => {
    if (n.type === "import_statement") {
      for (const c of n.namedChildren) {
        const d = c.type === "aliased_import" ? c.childForFieldName("name") : c;
        if (d?.type === "dotted_name") res.push({ kind: "import", mod: d.text, names: [], level: 0, line: n.startPosition.row + 1, tc });
      }
      return;
    }
    if (n.type === "import_from_statement") {
      const m = n.childForFieldName("module_name");
      let level = 0, mod = "";
      if (m.type === "relative_import") {
        level = (m.namedChildren.find((c) => c.type === "import_prefix")?.text ?? "").length;
        mod = m.namedChildren.find((c) => c.type === "dotted_name")?.text ?? "";
      } else mod = m.text;
      const names = n.childrenForFieldName("name").map((c) => (c.type === "aliased_import" ? c.childForFieldName("name").text : c.text));
      if (n.namedChildren.some((c) => c.type === "wildcard_import")) names.push("*");
      res.push({ kind: "from", mod, names, level, line: n.startPosition.row + 1, tc });
      return;
    }
    if (n.type === "call") {
      const f = n.childForFieldName("function");
      const fname = f?.type === "attribute" ? f.childForFieldName("attribute")?.text : f?.text;
      if (fname === "import_module" || fname === "__import__") {
        const a0 = n.childForFieldName("arguments")?.namedChildren[0];
        const lit = a0?.type === "string" && a0.namedChildren.every((c) => c.type !== "interpolation");
        const text = lit ? a0.text.replace(/^[rRbBuU]*('''|"""|'|")|('''|"""|'|")$/g, "") : null;
        if (text && /^[\w.]+$/.test(text)) res.push({ kind: "dynamic", mod: text, names: [], level: 0, line: n.startPosition.row + 1, tc });
        else res.push({ kind: "computed", mod: null, names: [], level: 0, line: n.startPosition.row + 1, tc });
      }
    }
    // 007-04 fix: web-tree-sitter returns a new wrapper per call, so compare node ids, not objects.
    const cons = isTC(n) ? n.childForFieldName("consequence")?.id : undefined;
    for (const c of n.namedChildren) walk(c, tc || (cons !== undefined && c.id === cons));
  };
  walk(tree.rootNode, false);
  tree.delete();
  return res;
}

// ---------- sys.path model from files
const tSetup = performance.now();
const basedirOf = (file) => {
  let d = path.dirname(file);
  const parts = [path.basename(file, ".py")];
  while (fs.existsSync(path.join(d, "__init__.py"))) { parts.unshift(path.basename(d)); d = path.dirname(d); }
  return { dir: d, mod: parts.join(".") };
};
const entries = [];
for (const f of pyFiles) {
  const b = path.basename(f);
  if (b === "conftest.py" || /^test_.*\.py$/.test(b) || /_test\.py$/.test(b)) {
    const d = basedirOf(f).dir;
    if (!entries.includes(d)) entries.unshift(d);
  }
}
const mappings = [];
// --stdlib=<file of names>: no environment, so stand in for the stdlib directory with the interpreter's
// sys.stdlib_module_names, placed where the stdlib sits on sys.path (after the basedirs, before the roots).
const STDLIB = "/<stdlib>";
const stdNames = new Set(opt.stdlib ? fs.readFileSync(opt.stdlib, "utf8").split("\n").filter(Boolean) : []);
if (opt.roots) {
  const d = JSON.parse(fs.readFileSync(opt.roots, "utf8"));
  if (opt.stdlib) entries.push(STDLIB);
  for (const e of d.entries) { const p = path.resolve(root, e.path); if (!entries.includes(p)) entries.push(p); }
  for (const m of d.mappings) { const p = path.resolve(root, m.path); if (p.endsWith(".py")) mappings.push({ name: m.name, file: p }); else mappings.push({ name: m.name, dir: p }); }
} else {
  const cfg = Object.fromEntries(
    fs.readFileSync(path.join(venv, "pyvenv.cfg"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((s) => s.trim())),
  );
  const ver = (cfg.version_info ?? cfg.version).split(".").slice(0, 2).join(".");
  const stdlib = path.resolve(cfg.home, "..", "lib", `python${ver}`);
  const site = path.join(venv, "lib", `python${ver}`, "site-packages");
  
  entries.push(stdlib, path.join(stdlib, "lib-dynload"), site);
  for (const pth of fs.readdirSync(site).filter((f) => f.endsWith(".pth")).sort()) {
    for (const l of fs.readFileSync(path.join(site, pth), "utf8").split("\n")) {
      const line = l.trim();
      if (!line || line.startsWith("#")) continue;
      if (/^import[\s\t]/.test(line)) {
        const m = /^import\s+([\w.]+)/.exec(line);
        const modFile = m && path.join(site, m[1] + ".py");
        if (modFile && fs.existsSync(modFile)) {
          const text = fs.readFileSync(modFile, "utf8");
          const mm = /^MAPPING\s*(?::[^=]*)?=\s*(\{.*\})\s*$/m.exec(text);
          if (mm) for (const [k, v] of Object.entries(JSON.parse(mm[1].replace(/'/g, '"')))) mappings.push({ name: k, dir: v });
          for (const c of text.matchAll(/map_module\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) mappings.push({ name: c[1], file: c[2] });
        }
        continue;
      }
      const p = path.resolve(site, line);
      if (fs.existsSync(p) && !entries.includes(p)) entries.push(p);
    }
  }
  
}
const setupMs = performance.now() - tSetup;

// ---------- resolution
const inRoot = (p) => p.startsWith(root + path.sep) && !p.includes(`${path.sep}.venv`);
const exists = new Map();
const isFile = (p) => {
  let v = exists.get(p);
  if (v === undefined) { try { v = fs.statSync(p).isFile() ? 1 : 2; } catch { v = 0; } exists.set(p, v); }
  return v === 1;
};
const isDir = (p) => { isFile(p); return exists.get(p) === 2; };
const specCache = new Map();
function findIn(name, last, searchPath) {
  const portions = [];
  for (const d of searchPath) {
    if (d === STDLIB) { if (name === last && stdNames.has(name)) return { origin: path.join(STDLIB, name + ".py"), sub: [] }; continue; }
    const pkg = path.join(d, last);
    if (isFile(path.join(pkg, "__init__.py"))) return { origin: path.join(pkg, "__init__.py"), sub: [pkg] };
    if (isFile(pkg + ".py")) return { origin: pkg + ".py", sub: null };
    if (isDir(pkg)) portions.push(pkg);
  }
  for (const m of mappings) {
    if (m.name !== name) continue;
    if (m.dir) return { origin: path.join(m.dir, "__init__.py"), sub: [m.dir] };
    if (m.file) return { origin: m.file, sub: m.file.endsWith("__init__.py") ? [path.dirname(m.file)] : null };
  }
  return portions.length ? { origin: null, sub: portions } : null;
}
function find(full) {
  if (specCache.has(full)) return specCache.get(full);
  let spec = null;
  const i = full.lastIndexOf(".");
  if (i < 0) spec = findIn(full, full, entries);
  else {
    const parent = find(full.slice(0, i));
    if (parent?.sub) spec = findIn(full, full.slice(i + 1), parent.sub);
  }
  specCache.set(full, spec);
  return spec;
}
const specFiles = (s) => (s?.origin && inRoot(s.origin) ? [s.origin] : []);
const SYM = !!opt.sym;
function candidates(full) {
  // ast_graph.py's rule: absent <loc>/<last>.py and <loc>/<last>/__init__.py inside the worktree, in every
  // search location before the winning one (all of them when nothing wins). --sym: a winner outside the
  // worktree (stdlib, site-packages) does not stop the scan, so the set needs no environment.
  const i = full.lastIndexOf(".");
  const last = full.slice(i + 1);
  const locs = i < 0 ? entries : (find(full.slice(0, i))?.sub ?? []);
  const spec = find(full);
  const won = spec?.origin ? path.dirname(spec.origin) : null;
  const res = [];
  for (const d of locs) {
    if (won && (won === d || won === path.join(d, last)) && (!SYM || inRoot(spec.origin))) break;
    if (!inRoot(d) && d !== root) continue;
    for (const c of [path.join(d, last + ".py"), path.join(d, last, "__init__.py")]) if (!isFile(c)) res.push(c);
  }
  return res;
}
function resolveChain(name) {
  const files = [];
  const parts = name.split(".");
  for (let k = 1; k <= parts.length; k++) {
    const s = find(parts.slice(0, k).join("."));
    if (!s) return [files, false];
    files.push(...specFiles(s));
  }
  return [files, true];
}

if (parserKind === "treesitter") await initTreeSitter();
const parse = parserKind === "treesitter" ? tsParse : scanParse;
let parseMs = 0, resolveMs = 0;
const parsed = new Map();
for (const file of pyFiles) {
  const t = performance.now();
  parsed.set(file, parse(fs.readFileSync(file, "utf8")).filter((x) => !(SKIP_TC && x.tc)));
  parseMs += performance.now() - t;
}
function resolveAll() {
const result = {};
for (const file of pyFiles) {
  const imports = parsed.get(file);
  let { mod: modname } = basedirOf(file);
  const isPkg = file.endsWith("__init__.py");
  if (modname.endsWith(".__init__")) modname = modname.slice(0, -9);
  const pkg = isPkg ? modname : modname.split(".").slice(0, -1).join(".");
  const edges = new Set(), unresolved = [], computed = [], cands = new Set();
  let d = isPkg ? path.dirname(path.dirname(file)) : path.dirname(file);
  for (let k = 0; k < modname.split(".").length - 1; k++) { edges.add(path.join(d, "__init__.py")); d = path.dirname(d); }
  for (const { kind, mod: m0, names, level, line } of imports) {
    if (kind === "computed") { computed.push(line); continue; }
    let mod = m0;
    if (level) {
      const base = pkg.split(".").slice(0, pkg.split(".").length - (level - 1)).join(".");
      mod = mod ? `${base}.${mod}` : base;
    }
    const [files, ok] = resolveChain(mod);
    files.forEach((f) => edges.add(f));
    const parts = mod.split(".");
    for (let k = 1; k <= parts.length; k++) {
      const sub = parts.slice(0, k).join(".");
      candidates(sub).forEach((c) => cands.add(c));
      if (!find(sub)) break;
    }
    if (!ok) { unresolved.push(mod); continue; }
    for (const n of names) if (n !== "*") { specFiles(find(`${mod}.${n}`)).forEach((f) => edges.add(f)); candidates(`${mod}.${n}`).forEach((c) => cands.add(c)); }
  }
  edges.delete(file);
  result[path.relative(root, file)] = { module: modname, edges: [...edges].map((e) => path.relative(root, e)).sort(), unresolved, computed, candidates: [...cands].map((c) => path.relative(root, c)).sort() };
}
return result;
}
let t1 = performance.now();
const result = resolveAll();
resolveMs = performance.now() - t1;
const reresolve = [];
for (let k = 0; k < Number(opt.reresolve ?? 0); k++) {
  specCache.clear(); exists.clear();
  t1 = performance.now();
  const again = resolveAll();
  reresolve.push(performance.now() - t1);
  if (JSON.stringify(again) !== JSON.stringify(result)) throw new Error("re-resolve differs");
}
// closures: reverse index path -> test files, built from forward edges
t1 = performance.now();
const tests = Object.keys(result).filter((f) => /(^|\/)test_[^/]*\.py$/.test(f));
const rev = new Map();
let entriesN = 0;
for (const t of tests) {
  const seen = new Set(); const todo = [t];
  const parts = t.split("/").slice(0, -1);
  for (let i = 0; i <= parts.length; i++) { const c = [...parts.slice(0, i), "conftest.py"].join("/"); if (result[c]) todo.push(c); }
  while (todo.length) { const f = todo.pop(); if (seen.has(f)) continue; seen.add(f); todo.push(...(result[f]?.edges ?? [])); }
  for (const p of seen) { if (!rev.has(p)) rev.set(p, []); rev.get(p).push(t); entriesN++; }
}
const closureMs = performance.now() - t1;
const timing = { parser: parserKind, files: pyFiles.length, setup_ms: setupMs, parse_ms: parseMs, resolve_ms: resolveMs, reresolve_ms: reresolve, closures_and_reverse_index_ms: closureMs, reverse_entries: entriesN, test_files: tests.length, total_ms: performance.now() - t0, entries: entries.length, mappings: mappings.length };
fs.writeFileSync(out, JSON.stringify({ files: result, timing }));
console.log(JSON.stringify(timing));
