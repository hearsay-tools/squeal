// Throwaway probe for research 013-05, and the upstream reproduction: Vite alone, no Vitest.
//   node --expose-gc vite-repro.mjs <root> <cycles>
// Each cycle: createServer (no config file, no watcher, no HMR), transform one module through
// the ssr environment, close(). A WeakRef on each server; after two GCs, how many are alive.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, cyclesArg] = process.argv.slice(2);
const require = createRequire(join(root, "package.json"));
const { createServer, version } = await import(pathToFileURL(require.resolve("vite")).href);
const tick = () => new Promise((r) => setTimeout(r, 0));
const gc = async () => { for (let i = 0; i < 2; i++) { await tick(); globalThis.gc(); } await tick(); };
const refs = [];
for (let cycle = 1; cycle <= Number(cyclesArg); cycle++) {
  let server = await createServer({
    root, configFile: false, logLevel: "silent",
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  });
  await server.environments.ssr.transformRequest("/src/m1.ts");
  refs.push(new WeakRef(server));
  await server.close();
  server = null;
  await gc();
  const alive = refs.filter((r) => r.deref() !== undefined).length;
  await gc();
  console.log(JSON.stringify({ vite: version, cycle, alive, load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 2 ** 20) }));
}
process.exit(0);
