// For each source path on stdin, prints how many test files Vitest's `related` walk gives,
// to pick modules with a small reach. Usage: ls src/**.ts | node related-counts.mjs <root>. Throwaway (011-119).
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const root = process.argv[2];
const req = createRequire(path.join(root, 'package.json'));
const { createVitest } = await import(req.resolve('vitest/node'));
const vitest = await createVitest('test', { root, watch: false, reporters: [] });
for (const p of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  vitest.config.related = [path.resolve(root, p)];
  const specs = await vitest.getRelevantTestSpecifications();
  const files = [...new Set(specs.map((s) => path.relative(root, s.moduleId)))];
  console.log(files.length, p, files.slice(0, 6).join(' '));
}
await vitest.close();
