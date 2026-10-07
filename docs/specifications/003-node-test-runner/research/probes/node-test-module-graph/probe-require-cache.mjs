// THROWAWAY probe. Preload that prints, at exit, the project files in require.cache (CJS module cache).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.on("exit", () => {
  const keys = Object.keys(require.cache).filter((k) => k.includes("/fixtures/ref/") && !k.includes("/node_modules/"));
  process.stderr.write(`require.cache project entries: ${JSON.stringify(keys.map((k) => k.replace(/.*fixtures\/ref\//, "")))}\n`);
  for (const k of keys) process.stderr.write(`  ${k.replace(/.*fixtures\/ref\//, "")} children: ${JSON.stringify(require.cache[k].children.map((c) => c.id.replace(/.*fixtures\/ref\//, "")))}\n`);
});
