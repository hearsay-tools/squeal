// 011-157 probe (throwaway): closure-content signature of a test file at a commit, read from git (011-152 content.mjs method).
// A file's closure = its stored closure list + its observed set + the policy inputs that select it, all as stored now, hashed from `git ls-tree -r`.
// A listing path ("dir/") is the sorted tracked entry names below it. Equal signatures stand for equal keys; inferred, checked in validate.mjs.
// With MD_ENV=1, a stand-in for the project environment joins every signature: the blobs of every tracked vitest.config.* and vitest.workspace.*,
// and the root lockfile (package-lock.json without the root package's own version; pnpm-lock.yaml as is). Over-wide on purpose: a lower bound.
import { execFileSync } from "node:child_process"; import { createHash } from "node:crypto"; import { readFileSync } from "node:fs";
export function makeSig(db, gitDir, configPath) {
  const closures = new Map(db.prepare("SELECT project, path, closure_paths FROM test_files").all().map((t) => [t.project + "\0" + t.path, JSON.parse(t.closure_paths)]));
  const observed = new Map();
  for (const m of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) for (const [t, ps] of Object.entries(JSON.parse(m.value))) observed.set(m.key.slice(9) + "\0" + t, ps);
  const glob = (g) => new RegExp("^" + g.split("**/").map((s) => s.split("**").map((x) => x.split("*").map((y) => y.replace(/\{([^}]*)\}/g, "\u0001$1\u0002").replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\u0001([^\u0002]*)\u0002/g, (_, a) => "(?:" + a.split(",").join("|") + ")")).join("[^/]*")).join(".*")).join("(?:.*/)?") + "$");
  let raw = {}; try { raw = JSON.parse(readFileSync(configPath, "utf8")).inputs ?? {}; } catch {}
  const inputs = Array.isArray(raw) ? [] : Object.entries(raw).map(([k, v]) => [glob(k), v.map(glob)]);
  const trees = new Map(), sigs = new Map(), inputSets = new Map(), listings = new Map();
  function listing(c, t, d) {
    // One index per commit: each directory prefix ("" for the root) to the sorted names of the entries below it.
    if (!listings.has(c)) {
      const idx = new Map();
      for (const k of t.keys()) { const parts = k.split("/"); let pre = ""; for (const part of parts) { let s = idx.get(pre); if (!s) idx.set(pre, (s = new Set())); s.add(part); pre += part + "/"; } }
      listings.set(c, new Map([...idx].map(([k, v]) => [k, [...v].sort().join("/")])));
    }
    return listings.get(c).get(d) ?? "";
  }
  function tree(c) {
    if (trees.has(c)) return trees.get(c);
    let m = null;
    try { m = new Map(execFileSync("git", ["--git-dir", gitDir, "ls-tree", "-r", "--full-tree", c], { maxBuffer: 1 << 28 }).toString().trim().split("\n").map((l) => { const [meta, p] = l.split("\t"); return [p, meta.split(" ")[2]]; })); } catch {}
    trees.set(c, m); return m;
  }
  function inputPaths(path, c, t) {
    const sel = inputs.filter(([re]) => re.test(path)); if (!sel.length) return [];
    const id = sel.map(([re]) => re.source).join("|") + "@" + c;
    if (!inputSets.has(id)) { const gs = sel.flatMap(([, g]) => g); inputSets.set(id, [...t.keys()].filter((q) => gs.some((g) => g.test(q)))); }
    return inputSets.get(id);
  }
  const envSigs = new Map();
  function envSig(c, t) {
    if (process.env.MD_ENV !== "1") return "";
    if (envSigs.has(c)) return envSigs.get(c);
    const h = createHash("sha256");
    for (const [p, b] of [...t].filter(([p]) => /(^|\/)vitest\.(config|workspace)\.[cm]?[jt]s$/.test(p) && !p.startsWith(".ai/")).sort()) h.update(p + "\0" + b + "\0");
    if (t.has("package-lock.json")) {
      try { const j = JSON.parse(execFileSync("git", ["--git-dir", gitDir, "cat-file", "blob", t.get("package-lock.json")], { maxBuffer: 1 << 28 }).toString()); delete j.version; if (j.packages?.[""]) delete j.packages[""].version; h.update("lock\0" + JSON.stringify(j)); } catch { h.update("lock\0?"); }
    }
    if (t.has("pnpm-lock.yaml")) h.update("pnpm\0" + t.get("pnpm-lock.yaml"));
    const v = h.digest("hex"); envSigs.set(c, v); return v;
  }
  function sig(file, c) {
    const id = file + "@" + c; if (sigs.has(id)) return sigs.get(id);
    const t = tree(c); if (!t) { sigs.set(id, null); return null; }
    const path = file.split("\0")[1];
    const set = new Set([...(closures.get(file) ?? [path]), ...(observed.get(file) ?? []), ...inputPaths(path, c, t)]);
    const h = createHash("sha256"); h.update(envSig(c, t));
    for (const q of [...set].sort()) {
      if (q.endsWith("/") || q === "./") h.update(q + "\0" + listing(c, t, q === "./" ? "" : q) + "\0");
      else h.update(q + "\0" + (t.get(q) ?? "-") + "\0");
    }
    const s = h.digest("hex"); sigs.set(id, s); return s;
  }
  return { sig, tree, closures };
}
