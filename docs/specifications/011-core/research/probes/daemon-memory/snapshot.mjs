// Throwaway probe for research 011-53: two createVitest/standalone/close cycles, then a heap snapshot.
// Run in the scratch: node --expose-gc snapshot.mjs <root> <out.heapsnapshot>
import { join } from "node:path"; import { pathToFileURL } from "node:url"; import v8 from "node:v8";
const root = process.argv[2];
const { createVitest } = await import(pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href);
process.chdir(root);
for (let i = 1; i <= 2; i++) {
  let v = await createVitest("test", { root, watch: false, reporters: [{}], update: "none", fsModuleCache: false });
  await v.standalone(); await v.close(); v = null;
}
globalThis.gc(); globalThis.gc();
console.log(v8.writeHeapSnapshot(process.argv[3]));
process.exit(0);
