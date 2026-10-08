// THROWAWAY: after a run, does Vite's module graph hold the computed import() target, with its importer?
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [vitestDir, rootArg] = process.argv.slice(2);
const root = resolve(rootArg);
const { createVitest } = await import(pathToFileURL(join(resolve(vitestDir), 'dist/node.js')).href);
const vitest = await createVitest('test', { root, watch: false, reporters: [{}] });
await vitest.standalone();
const specs = (await vitest.globTestSpecifications()).filter((s) => s.moduleId.includes('e-dynamic'));
await vitest.runTestSpecifications(specs);
const target = join(root, 'scripts/child-lib.mjs');
for (const p of vitest.projects) for (const [name, env] of Object.entries(p.vite.environments)) {
  const mods = env.moduleGraph.getModulesByFile(target);
  if (!mods) { console.log(name, 'absent'); continue; }
  for (const m of mods) console.log(name, 'present; importers:', [...m.importers].map((i) => i.file?.replace(root + '/', '')));
}
await vitest.close(); process.exit(0);
