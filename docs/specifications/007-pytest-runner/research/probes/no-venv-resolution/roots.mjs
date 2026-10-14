// Throwaway (007-04): import roots of a worktree, two ways.
//   node roots.mjs derive <root>          from pyproject.toml files alone, no environment
//   node roots.mjs actual <root> [.venv]  from the .pth files and editable finders a sync wrote
// Both print {entries: [{pth, path}], mappings: [{name, path}], notes: [...]}, paths relative to <root>,
// entries in the order site.py adds them (sorted .pth file names).
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

const [mode, root0, venvArg, ...extraDirs] = process.argv.slice(2);
const root = fs.realpathSync(root0);
const rel = (p) => path.relative(root, p) || ".";
const out = { entries: [], mappings: [], notes: [] };

if (mode === "actual") {
  const venv = path.join(root, venvArg ?? ".venv");
  const lib = path.join(venv, "lib");
  const site = path.join(lib, fs.readdirSync(lib).find((d) => d.startsWith("python")), "site-packages");
  for (const pth of fs.readdirSync(site).filter((f) => f.endsWith(".pth")).sort()) {
    for (const l of fs.readFileSync(path.join(site, pth), "utf8").split("\n")) {
      const line = l.trim();
      if (!line || line.startsWith("#")) continue;
      if (/^import\s/.test(line)) {
        const m = /^import\s+([\w.]+)/.exec(line);
        const f = m && path.join(site, m[1] + ".py");
        if (!f || !fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, "utf8");
        const mm = /^MAPPING\s*(?::[^=]*)?=\s*(\{.*\})\s*$/m.exec(text);
        if (mm) for (const [k, v] of Object.entries(JSON.parse(mm[1].replace(/'/g, '"')))) out.mappings.push({ name: k, path: rel(v) });
        for (const c of text.matchAll(/map_module\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) out.mappings.push({ name: c[1], path: rel(c[2]) });
        continue;
      }
      const p = path.resolve(site, line);
      const r = p.startsWith(root) ? rel(p) : `OUTSIDE:${p}`;
      if (fs.existsSync(p) && !out.entries.some((e) => e.path === r)) out.entries.push({ pth, path: r }); // site.py skips missing and known dirs
    }
  }
  out.mappings.sort((a, b) => a.name.localeCompare(b.name));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}

// ---------- derive
const norm = (n) => n.toLowerCase().replace(/[-_.]+/g, "_"); // PEP 503 then underscores, as file names use
const readToml = (d) => {
  const f = path.join(d, "pyproject.toml");
  return fs.existsSync(f) ? parseToml(fs.readFileSync(f, "utf8")) : null;
};
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const get = (o, ...ks) => ks.reduce((a, k) => (a == null ? a : a[k]), o);
const nameOf = (t) => get(t, "project", "name") ?? get(t, "tool", "poetry", "name");

function rootsOf(dir, t) {
  const backend = get(t, "build-system", "build-backend") ?? "";
  const name = nameOf(t);
  const n = norm(name);
  const E = (pth, p) => out.entries.push({ pth, path: rel(p), from: `${rel(dir)} ${backend}` });
  const M = (mod, p) => out.mappings.push({ name: mod, path: rel(p), from: `${rel(dir)} ${backend}` });
  if (backend.startsWith("hatchling")) {
    const wheel = get(t, "tool", "hatch", "build", "targets", "wheel") ?? {};
    const build = get(t, "tool", "hatch", "build") ?? {};
    const devDirs = wheel["dev-mode-dirs"] ?? build["dev-mode-dirs"];
    const exact = wheel["dev-mode-exact"] ?? build["dev-mode-exact"];
    if (wheel.sources ?? build.sources) out.notes.push(`${rel(dir)}: hatch sources rewrite, only prefix removal modelled`);
    if (devDirs) { for (const d of devDirs) E(`_${n}.pth`, path.join(dir, d)); return; }
    let pkgs = wheel.packages ?? build.packages;
    let only = wheel["only-include"] ?? build["only-include"];
    if (!pkgs && !only && !(wheel.include ?? build.include)) {
      for (const cand of [name.replace(/[-.]/g, "_"), n]) {
        if (isFile(path.join(dir, cand, "__init__.py"))) { pkgs = [cand]; break; }
        if (isFile(path.join(dir, "src", cand, "__init__.py"))) { pkgs = [`src/${cand}`]; break; }
        if (isFile(path.join(dir, `${cand}.py`))) { only = [`${cand}.py`]; break; }
      }
    }
    if (wheel.include ?? build.include) out.notes.push(`${rel(dir)}: hatch include globs not modelled`);
    const exposed = [...(pkgs ?? []), ...(only ?? [])].map((p) => path.join(dir, p));
    if (exact) for (const p of exposed) M(path.basename(p).replace(/\.py$/, ""), isDir(p) ? path.join(p, "__init__.py") : p);
    else for (const p of [...new Set(exposed.map((p) => path.dirname(p)))]) E(`_editable_impl_${n}.pth`, p);
    return;
  }
  if (backend.startsWith("pdm.backend")) {
    const b = get(t, "tool", "pdm", "build") ?? {};
    const pd = b["package-dir"] ?? (isDir(path.join(dir, "src")) && !b.includes ? "src" : "");
    if ((b["editable-backend"] ?? "path") !== "path") out.notes.push(`${rel(dir)}: pdm editables backend not modelled`);
    E(`_editable_impl_${n}.pth`, path.join(dir, pd));
    return;
  }
  if (backend.startsWith("flit_core")) {
    const mod = get(t, "tool", "flit", "module", "name") ?? name.replace(/-/g, "_");
    const p = mod.replace(/\./g, "/");
    const inSrc = isDir(path.join(dir, "src", p)) || isFile(path.join(dir, "src", p + ".py"));
    E(`${mod}.pth`, inSrc ? path.join(dir, "src") : dir);
    return;
  }
  if (backend.startsWith("poetry.core")) {
    let pk = get(t, "tool", "poetry", "packages");
    if (!pk) pk = [{ include: name.replace(/-/g, "_"), from: isDir(path.join(dir, "src", name.replace(/-/g, "_"))) ? "src" : undefined }];
    for (const base of [...new Set(pk.map((p) => p.from ?? "."))]) E(`${name.replace(/-/g, "_")}.pth`, path.join(dir, base));
    return;
  }
  if (backend === "uv_build") {
    const b = get(t, "tool", "uv", "build-backend") ?? {};
    E(`${n}.pth`, path.join(dir, b["module-root"] ?? "src"));
    return;
  }
  if (backend.startsWith("setuptools")) {
    const st = get(t, "tool", "setuptools") ?? {};
    let pd = st["package-dir"] ?? {};
    const find = get(st, "packages", "find");
    const ver = get(t, "project", "version") ?? "<dynamic>";
    if (fs.existsSync(path.join(dir, "setup.py"))) out.notes.push(`${rel(dir)}: setup.py present, its code is not read`);
    if (find?.where) {
      if (find.where.length === 1) pd = { "": find.where[0] };
      else out.notes.push(`${rel(dir)}: several find.where, finder MAPPING not modelled`);
    }
    if (!st["package-dir"] && !find && !st.packages && isDir(path.join(dir, "src"))) pd = { "": "src" }; // src auto-discovery
    const keys = Object.keys(pd);
    if (keys.length === 1 && keys[0] === "") { E(`__editable__.${n}-${ver}.pth`, path.join(dir, pd[""])); return; }
    // flat or mapped layout: setuptools writes a finder with a MAPPING of top-level packages
    let pkgs = Array.isArray(st.packages) ? st.packages.filter((p) => !p.includes(".")) : null;
    if (!pkgs) pkgs = fs.readdirSync(dir).filter((d) => isFile(path.join(dir, d, "__init__.py")) && !/^(tests?|docs?|examples?|build|dist)$/.test(d));
    for (const p of pkgs) M(p, path.join(dir, pd[p] ?? (pd[""] ? path.join(pd[""], p) : p)));
    return;
  }
  out.notes.push(`${rel(dir)}: backend '${backend}' not modelled`);
}

const top = readToml(root);
const installed = new Map(); // dir -> toml
const isPackage = (t) => get(t, "tool", "uv", "package") ?? !!get(t, "build-system", "build-backend");
if (top && (nameOf(top)) && isPackage(top)) installed.set(root, top);
else if (top) out.notes.push("root project not installed (no build-system or tool.uv.package = false)");
// uv workspace members, reachable from the root's dependencies and default groups
const members = new Map();
for (const g of get(top, "tool", "uv", "workspace", "members") ?? []) {
  const parts = g.split("/");
  let dirs = [root];
  for (const p of parts) dirs = dirs.flatMap((d) => (p.includes("*") ? (isDir(d) ? fs.readdirSync(d).filter((x) => new RegExp(`^${p.replace(/\*/g, ".*")}$`).test(x)).map((x) => path.join(d, x)) : []) : [path.join(d, p)]));
  for (const d of dirs) { const t = readToml(d); if (t && nameOf(t)) members.set(norm(nameOf(t)), { dir: d, t }); }
}
const depName = (s) => norm(/^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(s)[0]);
const depsOf = (t) => [...(get(t, "project", "dependencies") ?? []), ...(get(t, "dependency-groups", "dev") ?? []).filter((x) => typeof x === "string")].map(depName);
const seen = new Set();
const walk = (dir, t) => {
  const sources = get(t, "tool", "uv", "sources") ?? get(top, "tool", "uv", "sources") ?? {};
  for (const d of depsOf(t)) {
    if (seen.has(d)) continue;
    seen.add(d);
    const src = Object.entries(sources).find(([k]) => norm(k) === d)?.[1];
    if (members.has(d) && (!src || src.workspace)) { const m = members.get(d); if (isPackage(m.t)) installed.set(m.dir, m.t); walk(m.dir, m.t); continue; }
    if (src?.path) {
      const p = path.resolve(dir, src.path);
      if (!p.startsWith(root + path.sep)) { out.notes.push(`path source ${d} outside the worktree: ${src.path}`); continue; }
      const pt = readToml(p);
      if (src.editable) installed.set(p, pt);
      else out.notes.push(`path source ${d} (${rel(p)}) installed as a copy, resolves to site-packages`);
    }
  }
};
if (top) walk(root, top);
for (const d of mode === "derive" && venvArg ? [venvArg, ...extraDirs] : []) { const p = path.resolve(root, d); installed.set(p, readToml(p)); out.notes.push(`declared editable: ${rel(p)}`); }
for (const [d, t] of installed) rootsOf(d, t);
out.entries.sort((a, b) => (a.pth < b.pth ? -1 : a.pth > b.pth ? 1 : 0));
out.mappings.sort((a, b) => a.name.localeCompare(b.name));
console.log(JSON.stringify(out, null, 1));
