#!/usr/bin/env bash
# THROWAWAY probe. When x.js and x.ts both exist, which one does tsx load, and which do the static resolvers pick?
HERE=$(cd "$(dirname "$0")" && pwd); D=$HERE/fixtures/prec; NODE=${1:-node}
rm -rf "$D"; mkdir -p "$D/src/d"; cd "$D"; echo '{"type":"module"}' > package.json
for n in a b; do echo "export const who = '$n.js';" > src/$n.js; echo "export const who: string = '$n.ts';" > src/$n.ts; done
echo "export const who: string = 'c.ts';" > src/c.ts
echo "export const who = 'd.ts';" > src/d.ts; echo "export const who = 'd/index.ts';" > src/d/index.ts
printf 'import { who as a } from "./src/a.js";\nimport { who as b } from "./src/b";\nimport { who as d } from "./src/d";\nconsole.log("ts importer ", JSON.stringify({ "./src/a.js": a, "./src/b": b, "./src/d": d }));\n' > main.ts
printf 'import { who as a } from "./src/a.js";\nimport { who as c } from "./src/c.js";\nconsole.log("mjs importer", JSON.stringify({ "./src/a.js": a, "./src/c.js (only c.ts)": c }));\n' > main.mjs
echo "tsx on $($NODE -v):"; $NODE --import tsx main.ts 2>&1 | grep importer; $NODE --import tsx main.mjs 2>&1 | grep importer
cd "$HERE"; $NODE --input-type=module -e "
import { makeResolver } from './static-graph.mjs'; import { realpathSync } from 'node:fs';
for (const imp of ['main.ts', 'main.mjs']) { const from = realpathSync('fixtures/prec/' + imp);
for (const n of ['oxc','enhanced','ts-bundler','hand']) { const r = makeResolver(n); console.log(imp.padEnd(8), n.padEnd(10), ['./src/a.js','./src/b','./src/d'].map(s => s + ' -> ' + (r(s, from, 'import').path ?? 'unresolved').replace(/.*prec\//,'')).join(', ')); } }" 2>&1 | grep -v "Experimental\|trace-warn"
