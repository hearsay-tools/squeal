import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/tmp/el115/store/store.sqlite');
const [project, path, filter] = process.argv.slice(2);
const r = db.prepare('select closure_paths, updated_at, updated_by from test_files where project=? and path=?').get(project, path);
const ps = JSON.parse(r.closure_paths);
console.log('total', ps.length, new Date(r.updated_at).toISOString(), r.updated_by);
const tops = {};
for (const p of ps) { const t = p.split('/').slice(0,2).join('/'); tops[t]=(tops[t]||0)+1; }
console.log(JSON.stringify(Object.entries(tops).sort((a,b)=>b[1]-a[1]).slice(0,40)));
for (const p of ps) if (filter && p.includes(filter)) console.log(p);
