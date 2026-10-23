// 011-162 probe, not product code (brief question 3). After `pnpm update`, `.pnpm` keeps folders
// no snapshot names (orphans, pruned after `modules-cache-max-age`). Does any symlink a lookup can
// follow (the root's, each importer's, `.pnpm/node_modules`, each listed folder's `node_modules`)
// point into one?
//   node orphans.mjs <install-root>
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readInstall } from "./pnpm-graph.mjs";

const root = process.argv[2];
const install = readInstall(root);
const listed = new Set(install.dirOf.values());
const store = join(root, "node_modules/.pnpm");
const orphans = new Set(readdirSync(store).filter((n) => n !== "node_modules" && n !== "lock.yaml" && !listed.has(n)));
const dirs = [
  join(root, "node_modules"),
  ...Object.keys(install.lock.importers).filter((p) => p !== ".").map((p) => join(root, p, "node_modules")),
  join(store, "node_modules"),
  ...[...listed].map((d) => join(store, d, "node_modules")),
];
let links = 0;
const intoOrphan = [];
for (const dir of dirs) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    const children =
      entry.name.startsWith("@") && entry.isDirectory()
        ? readdirSync(join(dir, entry.name), { withFileTypes: true }).map((c) => [join(dir, entry.name, c.name), c])
        : [[join(dir, entry.name), entry]];
    for (const [path, child] of children) {
      if (!child.isSymbolicLink()) continue;
      links += 1;
      const target = resolve(dirname(path), readlinkSync(path));
      const folder = target.startsWith(`${store}/`) ? target.slice(store.length + 1).split("/")[0] : null;
      if (folder !== null && orphans.has(folder)) intoOrphan.push(path.slice(root.length + 1));
    }
  }
}
const prunedAt = /"prunedAt": "([^"]+)"/.exec(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"))?.[1];
console.log(JSON.stringify({ root, orphans: orphans.size, symlinks: links, intoOrphan: intoOrphan.length, sample: intoOrphan.slice(0, 5), prunedAt }));
