// Throwaway probe for research 011-53: do process listeners grow over createVitest/close cycles?
// Run in the scratch: node listeners.mjs <root>
import { join } from "node:path"; import { pathToFileURL } from "node:url";
const root = process.argv[2];
const { createVitest } = await import(pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href);
process.chdir(root);
const ev = () => Object.fromEntries(process.eventNames().map((e) => [String(e), process.listenerCount(e)]));
console.log("start", JSON.stringify(ev()));
for (let i = 1; i <= 3; i++) {
  const v = await createVitest("test", { root, watch: false, reporters: [{}], update: "none", fsModuleCache: false });
  await v.standalone(); await v.close();
  console.log("closed", i, JSON.stringify(ev()));
}
process.exit(0);
