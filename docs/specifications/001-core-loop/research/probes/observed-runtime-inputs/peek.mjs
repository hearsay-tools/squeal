// THROWAWAY: print one test file's observed extra paths
import { readFileSync } from 'node:fs';
const [json, file, n = 25] = process.argv.slice(2);
const d = JSON.parse(readFileSync(json, 'utf8'));
const k = Object.keys(d.modules).find((x) => x.includes(file));
const imports = new Set(d.modules[k].imports);
const e = Object.entries(d.observed[k] ?? {}).filter(([p]) => !p.startsWith('/') && !p.includes('node_modules/') && !imports.has(p));
console.log(k, e.length); for (const [p, kinds] of e.slice(0, +n)) console.log('  ', p.slice(0, 110), kinds.join(','));
