// Throwaway probe (001-102): the installed npm dependency graph read from node_modules/.package-lock.json.
// resolve() follows Node's lookup: <from>/node_modules/<name>, then each ancestor, then the root.
// closure() is the transitive set over dependencies, optionalDependencies and peerDependencies.
import { readFileSync } from "node:fs";

export function readLock(path) {
  return JSON.parse(readFileSync(path, "utf8")).packages;
}

/** Install location of `name` as seen from location `from` ("" for the root), or null. */
export function resolve(packages, from, name) {
  let dir = from;
  for (;;) {
    const loc = dir === "" ? `node_modules/${name}` : `${dir}/node_modules/${name}`;
    if (packages[loc]) return follow(packages, loc);
    if (dir === "") return null;
    const i = dir.lastIndexOf("/node_modules/");
    dir = i === -1 ? "" : dir.slice(0, i);
  }
}
// A workspace location like "packages/cezar" looks in its own node_modules, then the root's.
// A link entry (workspace symlink) points at its target location.
const follow = (packages, loc) => (packages[loc].link ? packages[loc].resolved : loc);

/** Locations reachable from `starts`, and the names that did not resolve, as "absent:<from>:<name>". */
export function closure(packages, starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const loc = stack.pop();
    if (seen.has(loc)) continue;
    seen.add(loc);
    // Absent names have no edges; workspace packages are project files whose imports the closure walk sees.
    if (loc.startsWith("absent:") || !loc.includes("node_modules/")) continue;
    const entry = packages[loc] ?? {};
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const name of Object.keys(entry[field] ?? {})) {
        const target = resolve(packages, loc, name);
        if (target !== null) stack.push(target);
        // An optional or peer dependency that is not installed is part of the state too.
        else stack.push(`absent:${loc}:${name}`);
      }
    }
  }
  return seen;
}

/** What a location contributes to a key. Workspace packages are project files, keyed by the closure. */
export function identity(packages, loc) {
  if (loc.startsWith("absent:")) return loc;
  const e = packages[loc];
  if (!e) return `absent:${loc}`;
  if (!loc.includes("node_modules/")) return `workspace:${loc}`;
  return `${loc}@${e.version}#${e.integrity ?? e.resolved ?? ""}`;
}

/**
 * Whether an installed package ships no runtime file: only declarations, docs and its manifest.
 * Such a package changes what tsc sees, never what Node loads.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
export function typesOnly(root, loc) {
  const runtime = /\.(c|m)?js$|\.node$|\.wasm$|\.json$/;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).some((e) => {
    if (e.name === "node_modules") return false;
    if (e.isDirectory()) return walk(join(dir, e.name));
    return e.name !== "package.json" && runtime.test(e.name) && !/\.d\.(c|m)?ts$/.test(e.name);
  });
  try { return !walk(join(root, loc)); } catch { return false; }
}
