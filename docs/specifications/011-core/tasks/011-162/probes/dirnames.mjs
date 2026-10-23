// 011-162 probe, not product code. Does pnpm 10's `depPathToFilename`, applied to every
// `snapshots:` id of an installed `node_modules/.pnpm/lock.yaml`, give exactly the directory
// names under `node_modules/.pnpm/` that the installing pnpm wrote?
//   node dirnames.mjs <install-root>
import { readdirSync, readFileSync } from "node:fs";
import { hash } from "node:crypto";
import { join } from "node:path";
import { parse } from "yaml";

const root = process.argv[2];
const t0 = performance.now();
const lock = parse(readFileSync(join(root, "node_modules/.pnpm/lock.yaml"), "utf8"));
const parseMs = performance.now() - t0;
const modules = JSON.parse(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"));
const max = modules.virtualStoreDirMaxLength ?? 120;

// pnpm 10.32.0, dist/pnpm.cjs: depPathToFilename, depPathToFilenameUnescaped, createShortHash.
function depPathToFilename(depPath, maxLengthWithoutHash) {
  let filename = unescaped(depPath).replace(/[\\/:*?"<>|#]/g, "+");
  if (filename.includes("(")) filename = filename.replace(/\)$/, "").replace(/\)\(|\(|\)/g, "_");
  if (filename.length > maxLengthWithoutHash || (filename !== filename.toLowerCase() && !filename.startsWith("file+"))) {
    return `${filename.substring(0, maxLengthWithoutHash - 33)}_${hash("sha256", filename, "hex").substring(0, 32)}`;
  }
  return filename;
}
function unescaped(depPath) {
  if (depPath.startsWith("file:")) return depPath.replace(":", "+");
  if (depPath[0] === "/") depPath = depPath.substring(1);
  const index = depPath.indexOf("@", 1);
  return index === -1 ? depPath : `${depPath.substring(0, index)}@${depPath.slice(index + 1)}`;
}

const snapshots = Object.keys(lock.snapshots ?? {});
const computed = new Map(snapshots.map((id) => [depPathToFilename(id, max), id]));
const dirs = readdirSync(join(root, "node_modules/.pnpm")).filter((d) => d !== "node_modules" && d !== "lock.yaml");
const unmatchedDirs = dirs.filter((d) => !computed.has(d));
const present = new Set(dirs);
const unmatchedSnapshots = [...computed].filter(([d]) => !present.has(d)).map(([, id]) => id);
const hashed = [...computed.keys()].filter((d) => /_[0-9a-f]{32}$/.test(d)).length;
const variants = new Map();
for (const id of snapshots) {
  const base = id.replace(/\(.*$/, "");
  variants.set(base, (variants.get(base) ?? 0) + 1);
}
console.log(
  JSON.stringify(
    {
      root,
      pnpm: modules.packageManager,
      nodeLinker: modules.nodeLinker,
      virtualStoreDir: modules.virtualStoreDir,
      virtualStoreDirMaxLength: max,
      parseMs: Math.round(parseMs),
      snapshots: snapshots.length,
      packages: Object.keys(lock.packages ?? {}).length,
      dirs: dirs.length,
      matched: dirs.length - unmatchedDirs.length,
      hashedNames: hashed,
      peerVariantPackages: [...variants].filter(([, n]) => n > 1).length,
      unmatchedDirs: unmatchedDirs.slice(0, 10),
      unmatchedSnapshots: unmatchedSnapshots.slice(0, 10),
      unmatchedSnapshotCount: unmatchedSnapshots.length,
    },
    null,
    1,
  ),
);
