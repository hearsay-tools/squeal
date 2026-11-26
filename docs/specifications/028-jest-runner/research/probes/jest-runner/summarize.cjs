// Throwaway probe (spec 028 research). Summarizes observe output per mechanism:
// for each test file, which fixture paths each mechanism saw.
// Usage: node summarize.js <obsDir> <fixtureRoot>
const fs = require('fs');
const path = require('path');
const [dir, root] = process.argv.slice(2);
const rel = (p) => (p && p.startsWith(root) ? path.relative(root, p) : null);
const by = {};
const add = (mech, test, p) => {
  const r = rel(p);
  if (!r || r.includes('node_modules')) return;
  const k = `${mech} :: ${rel(test) ?? test}`;
  (by[k] ??= new Set()).add(r);
};
for (const f of fs.readdirSync(dir)) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
  for (const l of lines) {
    const o = JSON.parse(l);
    if (f.startsWith('runtime-')) add('runtime.' + o.kind, o.test, o.path);
    else if (f.startsWith('resolver-')) add('resolver', '(per worker)', o.result);
    else if (o.t !== undefined) {
      for (const k of ['f', 'l', 'r', 'w', 'd', 'm']) for (const p of o[k] ?? []) add('recorder.' + k, o.t, p);
    }
  }
}
for (const k of Object.keys(by).sort()) console.log(k + '\n   ' + [...by[k]].sort().join(' '));
