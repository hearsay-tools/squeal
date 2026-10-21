// Throwaway probe for research 013-05: two createVitest/standalone/run/close cycles (with
// "break": the retainer cut of break.mjs after each close), then a heap snapshot.
//   node --expose-gc snapshot.mjs <root> <out.heapsnapshot> [break]
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
const [root, out, mode] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const cut = mode === "break" ? (await import("./break.mjs")).breakRetainer : null;
process.chdir(root);
for (let i = 1; i <= 2; i++) {
  let v = await createVitest("test", { root, watch: false, reporters: [{}], update: "none", includeTaskLocation: true, fsModuleCache: false, maxWorkers: 2 });
  await v.standalone();
  const specs = (await v.globTestSpecifications()).filter((s) => s.moduleId.endsWith("m1.test.ts"));
  await v.runTestSpecifications(specs);
  await v.close();
  if (cut) console.log("emptied", cut(v));
  v = null;
}
for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); globalThis.gc(); }
console.log(v8.writeHeapSnapshot(out));
process.exit(0);
