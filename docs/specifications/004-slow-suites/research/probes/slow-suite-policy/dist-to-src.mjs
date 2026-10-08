// Throwaway. node dist-to-src.mjs <observed dir> <repo root> [sets.json]
// Maps each test file's observed build-output modules back to sources through
// their `.js.map` `sources`, so a source edit could select the slow file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const [dir, root] = process.argv.slice(2);
const allSrc = new Set();
const sets = {};
for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dist = new Set(), src = new Set(), direct = new Set();
  for (const p of readdirSync(`${dir}/${name}`))
    for (const line of readFileSync(`${dir}/${name}/${p}`, "utf8").split("\n").filter(Boolean)) {
      const { url } = JSON.parse(line);
      if (!url.startsWith("file:")) continue;
      const f = fileURLToPath(url);
      if (!f.startsWith(`${root}/`) || f.includes("/node_modules/")) continue;
      const rel = relative(root, f);
      if (/\/dist\//.test(rel)) {
        dist.add(rel);
        const map = `${f}.map`;
        if (existsSync(map))
          for (const s of JSON.parse(readFileSync(map, "utf8")).sources) src.add(relative(root, resolve(dirname(f), s)));
      } else if (/\/src\//.test(rel)) direct.add(rel);
    }
  for (const s of [...src, ...direct]) allSrc.add(s);
  sets[name] = [...new Set([...src, ...direct])];
  console.log(`${name}\tdist=${dist.size}\tsrcViaMaps=${src.size}\tsrcDirect=${direct.size}\tunion=${new Set([...src, ...direct]).size}`);
}
console.log(`union over all files: ${allSrc.size}`);
if (process.argv[4]) (await import("node:fs")).writeFileSync(process.argv[4], JSON.stringify(sets));
