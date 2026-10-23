// 011-162 probe, not product code: the layout fields pnpm records in `node_modules/.modules.yaml`.
//   node modules-fields.mjs <install-root>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

let modules;
try {
  modules = parse(readFileSync(join(process.argv[2], "node_modules/.modules.yaml"), "utf8"));
} catch (error) {
  console.log(`.modules.yaml: ${error.code ?? error.message}`);
  process.exit(0);
}
const kinds = {};
for (const aliases of Object.values(modules.hoistedDependencies ?? {})) {
  for (const kind of Object.values(aliases)) kinds[kind] = (kinds[kind] ?? 0) + 1;
}
const fields = ["nodeLinker", "virtualStoreDir", "enableGlobalVirtualStore", "publicHoistPattern", "hoistPattern", "shamefullyHoist", "layoutVersion"];
console.log(`.modules.yaml: ${JSON.stringify(Object.fromEntries(fields.map((f) => [f, modules[f]])))} hoisted ${JSON.stringify(kinds)}`);
