// Lists the test files Vitest's `related` walk gives for changed paths, as Squeal's adapter asks it.
// Usage: node related.mjs <repo root> <path>... (paths relative to the root). Throwaway (011-119).
import { createRequire } from 'node:module';
import path from 'node:path';
const [root, ...paths] = process.argv.slice(2);
const req = createRequire(path.join(root, 'package.json'));
const { createVitest } = await import(req.resolve('vitest/node'));
const vitest = await createVitest('test', { root, watch: false, reporters: [] });
vitest.config.related = paths.map((p) => path.resolve(root, p));
const specs = await vitest.getRelevantTestSpecifications();
for (const s of [...new Set(specs.map((s) => path.relative(root, s.moduleId)))].sort()) console.log(s);
await vitest.close();
