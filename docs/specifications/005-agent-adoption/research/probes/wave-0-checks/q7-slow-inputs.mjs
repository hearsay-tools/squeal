// Throwaway (005-04, question 7). Spec 005 D3's static slow-candidate and artifact
// rules, re-implemented from the spec text and run read-only over a repository.
// It imports nothing from the repository it reads and executes none of its code:
// files are read as text, and git runs only `ls-files` and `check-ignore`.
//
// Usage: node q7-slow-inputs.mjs <repo> <vitest-includes.json>
// The JSON is {"include": [...], "exclude": [...]} per Vitest project, written by
// hand from the repository's vitest configs (loading them would run its code).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, posix } from "node:path";

const [repo, projectsFile] = process.argv.slice(2);
const projects = JSON.parse(readFileSync(projectsFile, "utf8"));
const git = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 256 << 20 });
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") { const end = glob.indexOf("}", i); re += `(?:${glob.slice(i + 1, end).split(",").map(escape).join("|")})`; i = end; }
    else re += escape(c);
  }
  return new RegExp(`^${re}$`);
}
function escape(s) { return s.replace(/[.+^$()|[\]\\]/g, "\\$&"); }

// --- the test-file universe: Vitest projects, then node:test projects (003 D1's seed form)
const vitestFiles = new Set();
for (const p of projects) {
  const inc = p.include.map((g) => globToRegExp(posix.join(p.root ?? "", g)));
  const exc = (p.exclude ?? []).map((g) => globToRegExp(posix.join(p.root ?? "", g)));
  for (const f of tracked) if (inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f))) vitestFiles.add(f);
}
const readJson = (path) => { try { return JSON.parse(readFileSync(join(repo, path), "utf8")); } catch { return null; } };
const root = readJson("package.json") ?? {};
const ws = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages ?? [];
const pkgDirs = ["", ...ws.map((w) => w.replace(/^\.\//, "").replace(/\/$/, "")).filter((d) => existsSync(join(repo, d, "package.json")))];
const manifests = new Map(pkgDirs.map((d) => [d, readJson(join(d, "package.json")) ?? {}]));
const nameToDir = new Map([...manifests].map(([d, m]) => [m.name, d]));

/** `node [flags] --test <globs>` with no shell syntax: the globs, else null (003 D1, simplified). */
function nodeTestGlobs(text) {
  if (!/--test(?![\w-])/.test(text) || /[|&;<>$`\\()]/.test(text)) return null;
  const words = text.trim().split(/\s+/);
  if (words[0] !== "node") return null;
  const at = words.indexOf("--test");
  const globs = words.slice(at + 1);
  return globs.length && !globs.some((w) => w.startsWith("-")) ? globs : null;
}
const nodeTestProjects = [];
for (const [dir, m] of manifests)
  for (const [name, text] of Object.entries(m.scripts ?? {})) {
    const globs = typeof text === "string" ? nodeTestGlobs(text) : null;
    if (globs) nodeTestProjects.push({ dir, name, globs, files: tracked.filter((f) => globs.some((g) => globToRegExp(posix.join(dir, g)).test(f))) });
  }

// --- slow candidates (D3 "Slow tests and their inputs", step 1)
const reasons = new Map(); // file -> Set(reason)
const add = (f, why) => { if (!reasons.has(f)) reasons.set(f, new Set()); reasons.get(f).add(why); };
const universe = new Set([...vitestFiles, ...nodeTestProjects.flatMap((p) => p.files)]);
for (const f of universe) {
  if (f.split("/").slice(0, -1).includes("e2e")) add(f, "under a directory named e2e");
  if (/\.e2e\./.test(posix.basename(f))) add(f, "named *.e2e.*");
}
const SCRIPT_NAMES = ["test:e2e", "e2e", "test:integration", "test:package"];
const unresolved = [];
function scriptFiles(dir, name, depth = 0) {
  const text = manifests.get(dir)?.scripts?.[name];
  if (typeof text !== "string" || depth > 4) return null;
  const globs = nodeTestGlobs(text);
  if (globs) return tracked.filter((f) => globs.some((g) => globToRegExp(posix.join(dir, g)).test(f)));
  const npm = text.match(/^npm run (\S+)(?: (?:-w|--workspace) (\S+))?\s*$/);
  if (npm) return scriptFiles(npm[2] ? nameToDir.get(npm[2]) ?? npm[2] : dir, npm[1], depth + 1);
  const vit = text.match(/^vitest run((?: [^-\s]\S*)+)\s*$/);
  if (vit) return [...universe].filter((f) => vit[1].trim().split(/\s+/).some((p) => f.startsWith(posix.join(dir, p))));
  return { unresolved: text };
}
for (const [dir, m] of manifests)
  for (const name of SCRIPT_NAMES) {
    if (!(name in (m.scripts ?? {}))) continue;
    const got = scriptFiles(dir, name);
    if (Array.isArray(got)) for (const f of got) add(f, `run by npm script ${dir || "."}:${name}`);
    else unresolved.push(`${dir || "."}:${name} = ${JSON.stringify(got?.unresolved)} (not resolvable statically)`);
  }
for (const p of nodeTestProjects) for (const f of p.files) add(f, `node:test project ${p.dir || "."}:${p.name}`);

const groups = new Map(); // dir -> files
for (const f of reasons.keys()) { const d = dirname(f); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f); }

// --- artifact candidates (step 2)
function nearestPackage(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(repo, d, "package.json"))) return d === "." ? "" : d;
    if (d === "." || d === "/" || d === "") return "";
  }
}
const topDir = (p) => { const parts = normalize(p).replace(/^\.\//, "").split("/"); return parts.length > 1 ? parts[0] : null; };
const ignoredDirs = (() => {
  // every directory git would ignore, among those that exist or that a manifest/tsconfig names
  return (paths) => {
    if (!paths.length) return new Set();
    let out = "";
    try { out = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: repo, input: paths.map((p) => `${p}/`).join("\n"), encoding: "utf8" }); } catch (e) { out = e.stdout ?? ""; }
    return new Set(out.split("\n").filter(Boolean).map((p) => p.replace(/\/$/, "")));
  };
})();
function tsconfigOutDir(dir, tsconfig) {
  const text = (() => { try { return readFileSync(join(repo, dir, tsconfig), "utf8"); } catch { return null; } })();
  if (text === null) return null;
  const m = text.match(/"outDir"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  const ext = text.match(/"extends"\s*:\s*"(\.[^"]+)"/);
  return ext ? tsconfigOutDir(dir, ext[1]) : null;
}
function buildOutDirs(dir, m) {
  const out = [];
  for (const [name, text] of Object.entries(m.scripts ?? {})) {
    if (!/^(pre|post)?build(:|$)/.test(name) || typeof text !== "string") continue;
    for (const part of text.split(/&&|;/)) {
      const words = part.trim().split(/\s+/);
      if (words[0] === "tsc") {
        const p = words.indexOf("-p") >= 0 ? words[words.indexOf("-p") + 1] : words.indexOf("--project") >= 0 ? words[words.indexOf("--project") + 1] : "tsconfig.json";
        const flag = ["--outDir", "--outdir", "-o"].map((f) => words.indexOf(f)).find((i) => i >= 0);
        const o = flag !== undefined ? words[flag + 1] : tsconfigOutDir(dir, p);
        if (o) out.push({ path: o, why: `build script ${dir || "."}:${name} (${part.trim()} -> outDir ${o})` });
      } else {
        const flag = ["--outDir", "--outdir", "-o"].map((f) => words.indexOf(f)).find((i) => i >= 0);
        if (flag !== undefined) out.push({ path: words[flag + 1], why: `build script ${dir || "."}:${name} (${part.trim()})` });
        else out.push({ path: null, why: `build script ${dir || "."}:${name} (${part.trim()}): no rule names its output` });
      }
    }
  }
  return out;
}
const result = { repo, testFiles: universe.size, vitestFiles: vitestFiles.size, nodeTestProjects: nodeTestProjects.map(({ dir, name, globs, files }) => ({ project: `${dir || "."}:${name}`, globs, files: files.length })), unresolvedScripts: unresolved, groups: [] };
for (const [dir, files] of [...groups].sort()) {
  const pkg = nearestPackage(dir);
  const m = manifests.get(pkg) ?? readJson(join(pkg, "package.json")) ?? {};
  const cands = [];
  const fields = [];
  const walk = (v, key) => { if (typeof v === "string") fields.push({ key, v }); else if (Array.isArray(v)) v.forEach((x) => walk(x, key)); else if (v && typeof v === "object") Object.values(v).forEach((x) => walk(x, key)); };
  for (const key of ["bin", "main", "module", "exports", "files"]) walk(m[key], key);
  for (const { key, v } of fields) {
    const clean = v.replace(/^\.\//, "").replace(/\/$/, "");
    const isFile = existsSync(join(repo, pkg, clean)) ? !statSync(join(repo, pkg, clean)).isDirectory() : /\.\w+$/.test(clean);
    const d = key === "files" ? (isFile ? null : clean) : topDir(clean);
    if (d && d !== "package.json") cands.push({ path: posix.join(pkg, d), why: `${pkg || "."}/package.json ${key} "${v}"` });
  }
  for (const b of buildOutDirs(pkg, m)) cands.push({ path: b.path && posix.join(pkg, b.path.replace(/^\.\//, "")), why: b.why });
  // gitignored directories that exist (git's own list), plus, for the "if built" column,
  // the ignored directories the two rules above named; each kept when a string literal
  // in the group's own test files names it
  const texts = files.map((f) => readFileSync(join(repo, f), "utf8"));
  const existing = git("ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z")
    .split("\0").filter(Boolean).map((p) => p.replace(/\/$/, "")).filter((p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p));
  const named = ignoredDirs([...new Set(cands.map((c) => c.path).filter(Boolean))]);
  for (const d of [...new Set([...existing, ...named])]) {
    if (/\.\w+$/.test(posix.basename(d))) continue; // a file, not a directory
    // the path's tail inside its package ("dist", "web/dist"), matched as whole segments
    const tail = posix.relative(pkg || ".", d);
    const re = new RegExp(`(['"\`])[^'"\`\n]*(?<![\\w-])${escape(tail)}(?![\\w-])[^'"\`\n]*\\1`, "g");
    const hits = files.map((f, i) => [f, [...texts[i].matchAll(re)].map((x) => x[0]).slice(0, 3)]).filter(([, m]) => m.length);
    if (!hits.length) continue;
    const exists = existsSync(join(repo, d));
    cands.push({ path: d, rule: "gitignored+named", exists, fires: exists, why: `gitignored, ${exists ? "exists" : "absent in this checkout, so the rule does not fire until it is built"}; named by ${hits.length} of ${files.length} test files`, strings: Object.fromEntries(hits) });
  }
  result.groups.push({ group: dir, files: files.length, reasons: [...new Set(files.flatMap((f) => [...reasons.get(f)]))], package: pkg || ".", artifactCandidates: cands });
}
console.log(JSON.stringify(result, null, 1));
