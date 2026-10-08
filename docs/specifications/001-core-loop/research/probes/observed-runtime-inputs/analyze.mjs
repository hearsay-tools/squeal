// THROWAWAY: classify what the recorder saw per test file on a full-suite run (full.mjs output).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [json, root] = process.argv.slice(2);
const d = JSON.parse(readFileSync(json, 'utf8'));
const inRoot = (p) => !p.startsWith('/') && !p.includes('node_modules/');
const allPaths = new Set();
for (const m of Object.values(d.observed)) for (const p of Object.keys(m)) if (inRoot(p)) allPaths.add(p);
const ignored = new Set(execFileSync('git', ['-C', root, 'check-ignore', '--stdin'], { input: [...allPaths].join('\n'), encoding: 'utf8' }).split('\n').filter(Boolean));
let existenceOnly = 0, totalContent = 0, totalExtra = 0; let files = 0, grown = 0, grownContent = 0, grownSpawn = 0; const counts = {}; const byExt = {}; const perFile = []; let ignoredHits = new Map(); let writtenOnly = 0;
const snapRe = /__snapshots__\//;
for (const [t, mod] of Object.entries(d.modules)) {
  files++;
  const obs = d.observed[t] ?? {};
  const imports = new Set(mod.imports);
  const extra = [];
  for (let [p, kinds] of Object.entries(obs)) {
    if (!inRoot(p) || p === t || imports.has(p) || snapRe.test(p)) continue;
    kinds = kinds.filter((k) => k !== 'spawn'); if (kinds.length === 0) continue;
    if (kinds.includes('write')) { writtenOnly++; continue; }
    if (ignored.has(p)) { ignoredHits.set(p, (ignoredHits.get(p) ?? 0) + 1); continue; }
    extra.push([p, kinds]);
  }
  const content = extra.filter(([, k]) => k.some((x) => ['read', 'module', 'entry'].includes(x)));
  const spawned = extra.filter(([, k]) => k.includes('entry') || k.includes('argv'));
  if (extra.length) grown++; if (content.length) grownContent++; if (spawned.length) grownSpawn++;
  perFile.push([t, extra.length, content.length, mod.duration]); if (extra.length && !content.length) existenceOnly++; totalContent += content.length; totalExtra += extra.length;
  for (const [p, k] of extra) { const e = p.includes('.') ? p.slice(p.lastIndexOf('.')) : '(dir/none)'; byExt[e] = (byExt[e] ?? 0) + 1; for (const x of k) counts[x] = (counts[x] ?? 0) + 1; }
}
const none = d.observed['(none)'] ? Object.keys(d.observed['(none)']).filter(inRoot) : [];
console.log({ existenceOnly, totalContent, totalExtra, files, grown, grownContent, grownSpawn, writtenOnly, kinds: counts, byExt, unattributedInRoot: none.length });
console.log('ignored paths read:', [...ignoredHits].sort((a, b) => b[1] - a[1]).slice(0, 10));
perFile.sort((a, b) => b[1] - a[1]);
console.log('largest growth:', perFile.slice(0, 8));
const sizes = perFile.map((x) => x[1]).filter((n) => n > 0).sort((a, b) => a - b);
console.log('growth size p50/p90/max:', sizes[Math.floor(sizes.length / 2)], sizes[Math.floor(sizes.length * 0.9)], sizes.at(-1));
const parity = Object.keys(d.modules).find((k) => k.includes('runner-shutdown-parity'));
console.log('parity extra:', Object.entries(d.observed[parity] ?? {}).filter(([p]) => inRoot(p) && !new Set(d.modules[parity].imports).has(p)).map(([p, k]) => `${p} [${k}]`));
