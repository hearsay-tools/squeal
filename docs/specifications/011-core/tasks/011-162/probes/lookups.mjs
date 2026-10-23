// 011-162 probe, not product code. For every package import the Vitest adapter reported on a
// pnpm install (`measure-pnpm.mts`'s out file), compare the snapshot `pnpm-graph.mjs` maps it to
// with the folder Node's own lookup finds on disk: `<dir>/node_modules/<name>` in `from` and each
// parent, realpath'd into `node_modules/.pnpm/<folder>/node_modules/<name>`.
//   node lookups.mjs <install-root> <measure-out.json>
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, posix, relative } from "node:path";
// A manifest lookup never scans; the stub stands for `PackageScans`.
const PackageScans = class { typesOnly() { return false; } opaque() { return false; } };
import { PnpmGraph, readInstall } from "./pnpm-graph.mjs";

const [root, outFile] = process.argv.slice(2);
const { closures, environments } = JSON.parse(readFileSync(outFile, "utf8"));
const install = readInstall(root);
const graph = new PnpmGraph(root, "", install, new PackageScans());
const imports = new Map();
for (const c of closures) for (const i of c.packages?.imports ?? []) imports.set(`${i.from}\0${i.name}`, i);
for (const e of environments) for (const i of e.packages?.imports ?? []) imports.set(`${i.from}\0${i.name}`, i);

function nodeLookup(from, name) {
  for (let dir = from; ; dir = parent(dir)) {
    if (!dir.endsWith("node_modules")) {
      const candidate = join(root, dir, "node_modules", name);
      if (existsSync(candidate)) return relative(root, realpathSync(candidate));
    }
    if (dir === "") return null;
  }
}
function parent(dir) {
  const up = posix.dirname(dir);
  return up === "." ? "" : up;
}

const tally = {};
const mismatches = [];
for (const { from, name } of imports.values()) {
  const kind = from.startsWith("node_modules/.pnpm/") ? "entry Vite resolved" : "bare or required";
  const [identity] = graph.identities([{ from, name, manifest: true }]);
  const disk = nodeLookup(from, name);
  const expected =
    disk === null
      ? "absent"
      : disk.startsWith("node_modules/.pnpm/")
        ? disk.split("/")[2]
        : `workspace:${disk}`;
  const got = identity.startsWith("absent:")
    ? "absent"
    : identity.startsWith("workspace:")
      ? identity
      : install.dirOf.get(identity.replace(/#.*$/, "").replace(/@types-only$/, "")) ?? identity;
  const label = `${kind}: ${got === expected ? "same" : "differs"} (${expected === "absent" ? "absent" : expected.startsWith("workspace:") ? "workspace" : "snapshot"})`;
  tally[label] = (tally[label] ?? 0) + 1;
  if (got !== expected) mismatches.push({ from, name, graph: got, node: expected });
}
console.log(JSON.stringify({ root, distinctImports: imports.size, tally, mismatches: mismatches.slice(0, 15), mismatchCount: mismatches.length }, null, 1));

// Every edge of every installed snapshot: the folder its `dependencies` or `optionalDependencies`
// entry names, against Node's lookup from inside the snapshot's own package folder.
const edgeTally = {};
const edgeMismatches = [];
for (const [id, folder] of install.dirOf) {
  if (install.skipped.has(id)) continue;
  const name = id.slice(0, id.indexOf("@", 1));
  const from = `node_modules/.pnpm/${folder}/node_modules/${name}`;
  for (const field of ["dependencies", "optionalDependencies"]) {
    for (const [dep, ref] of Object.entries(install.snapshots[id]?.[field] ?? {})) {
      const plain = ref.replace(/\(.*$/, "");
      const child = plain.indexOf("@", 1) > 0 ? ref : `${dep}@${ref}`;
      const expected = install.skipped.has(child) ? "absent" : install.dirOf.get(child);
      const disk = nodeLookup(from, dep);
      const got = disk === null ? "absent" : disk.split("/")[2];
      const label = got === expected ? "same" : "differs";
      edgeTally[label] = (edgeTally[label] ?? 0) + 1;
      if (label === "differs") edgeMismatches.push({ id, dep, lock: expected, node: got });
    }
  }
}
console.log(JSON.stringify({ edges: edgeTally, edgeMismatches: edgeMismatches.slice(0, 10) }, null, 1));
