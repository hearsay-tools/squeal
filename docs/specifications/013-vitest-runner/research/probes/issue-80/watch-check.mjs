// Throwaway: prints server.watch of the root and each project server of a started Vitest instance.
// Usage: node watch-check.mjs <fixture root> (Vitest is resolved from the fixture's ancestors).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const req = createRequire(root + '/package.json');
const { createVitest } = await import(pathToFileURL(req.resolve('vitest/node')).href);
const vitest = await createVitest('test', { root, watch: false, reporters: [] });
console.log(JSON.stringify({ vitest: vitest.version, root: vitest.vite.config.server.watch, projects: vitest.projects.map(p => ({ name: p.name, watch: p.vite.config.server.watch })) }));
await vitest.close();
